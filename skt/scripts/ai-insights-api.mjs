import { GoogleGenAI } from '@google/genai';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { makeGa4MetricKey, queryGa4Metrics } from './ga4-data-api.mjs';

const SNAPSHOTS_ROOT = path.resolve('snapshots');
const PROMPT_INSTRUCTIONS = Object.freeze([
  '너는 GA4와 이커머스/통신 상품 UX를 함께 보는 한국어 데이터 분석가다.',
  '분석 대상은 SKT의 T world Shop 한국 메인페이지이며, PC는 shop.tworld.co.kr/shop/main, MO는 m.shop.tworld.co.kr/shop/main 데이터다.',
  '아래 JSON만 근거로 T world Shop 메인페이지 인사이트를 작성해라.',
  '데이터에 없는 사실, 판매 성과, 가입 전환, 구매 의도, 선호도, 원인 단정은 추측하지 마라.',
  'ga_action은 콘텐츠 영역 또는 컴포넌트 묶음, ga_label은 클릭 가능한 요소의 라벨로 해석하되 내부 태깅명일 수 있음을 감안해라.',
  '유지기간은 데이터 조회 기간 안에서 관찰된 기간이다. 유지기간 시작일을 실제 사이트 최초 노출일처럼 표현하지 마라.',
  '메인 배너, 최상단 띠배너, 휴대폰 구매/추천, 요금제/나만의 꿀 요금제, 이벤트/혜택처럼 ga_action별 콘텐츠 영역을 반드시 비교해라.',
  'rolling 배너나 carousel 요소는 offscreen으로 캡처될 수 있다. offscreen/hidden/inViewport 값만 보고 실제 사용자 노출 여부나 스와이프 행동을 단정하지 말고 해석 주의사항으로 다뤄라.',
  '오늘 날짜가 포함된 조회는 GA4 데이터가 지연될 수 있다. 수치가 낮거나 불완전해 보이면 확정 데이터 여부를 주의사항으로 남겨라.',
  '액션 제안은 배치 변경을 단정적으로 권하지 말고, 태깅 점검, 소재 비교, 영역별 클릭 비중 확인, 추가 분석 가설 중심으로 작성해라.',
  '모든 클릭 요소와 위치/유지기간/GA4 수치를 고려하되, 각 섹션에는 가능한 한 구체적인 수치를 포함해라.',
  '반드시 JSON만 출력해라. 마크다운 코드블록은 쓰지 마라.',
]);
const PROMPT_OUTPUT_SCHEMA = Object.freeze({
  headline: '한 문장 핵심 결론',
  summary: ['핵심 요약 3~5개'],
  uxInsights: ['위치, 화면 순서, 영역 맥락을 반영한 UX 인사이트 3~5개'],
  metricInsights: ['GA4 수치 기반 인사이트 3~5개'],
  sectionInsights: ['ga_action별 콘텐츠 영역 분석 3~5개'],
  changes: ['유지기간/신규/소멸/변경 관련 관찰 2~4개'],
  watchouts: ['데이터 해석 주의사항 2~4개'],
  actionItems: ['확인 또는 실행 제안 3~5개'],
});
const PROMPT_VERSION = crypto
  .createHash('sha1')
  .update(JSON.stringify({ instructions: PROMPT_INSTRUCTIONS, outputSchema: PROMPT_OUTPUT_SCHEMA }))
  .digest('hex')
  .slice(0, 12);
const CACHE_VERSION = `v1:${PROMPT_VERSION}`;
const INSIGHTS_CACHE_DIR = path.join(SNAPSHOTS_ROOT, 'ai-insights');
const GEMINI_PROJECT = process.env.GEMINI_PROJECT_ID || process.env.GOOGLE_CLOUD_PROJECT || process.env.GCP_PROJECT_ID || 'gyutae-test-project';
const GEMINI_LOCATION = process.env.GEMINI_LOCATION || process.env.GOOGLE_CLOUD_LOCATION || 'global';
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-3-flash-preview';
const GEMINI_APPLICATION_CREDENTIALS = process.env.GEMINI_APPLICATION_CREDENTIALS || process.env.GEMINI_GOOGLE_APPLICATION_CREDENTIALS || '';
const MAX_OUTPUT_TOKENS = positiveInteger(process.env.GEMINI_INSIGHTS_MAX_OUTPUT_TOKENS, 8192);
const GEMINI_RETRY_ATTEMPTS = positiveInteger(process.env.GEMINI_INSIGHTS_RETRY_ATTEMPTS, 3);
const GEMINI_RETRY_DELAY_MS = positiveInteger(process.env.GEMINI_INSIGHTS_RETRY_DELAY_MS, 12_000);

export async function queryAiInsights({ targetId, startDate, endDate }) {
  validateDate(startDate, 'startDate');
  validateDate(endDate, 'endDate');
  if (!targetId) throw new Error('targetId is required.');
  if (startDate > endDate) throw new Error('startDate must be earlier than or equal to endDate.');

  const cachePath = getInsightCachePath({ targetId, startDate, endDate });
  const cached = await readJsonFile(cachePath);
  if (cached) return { ...cached, cached: true };

  const analysis = await buildInsightInput({ targetId, startDate, endDate });
  const insight = await generateGeminiInsight(analysis);
  const payload = {
    status: 'ok',
    cached: false,
    cacheVersion: CACHE_VERSION,
    promptVersion: PROMPT_VERSION,
    generatedAt: new Date().toISOString(),
    provider: 'vertex-ai',
    model: GEMINI_MODEL,
    targetId,
    startDate,
    endDate,
    summary: summarizeAnalysisForResponse(analysis),
    insight,
  };

  await fs.mkdir(path.dirname(cachePath), { recursive: true });
  await fs.writeFile(cachePath, `${JSON.stringify(payload, null, 2)}\n`);
  return payload;
}

async function buildInsightInput({ targetId, startDate, endDate }) {
  const catalog = await readJsonFile(path.join(SNAPSHOTS_ROOT, 'catalog.json'));
  if (!catalog) throw new Error('catalog.json was not found.');

  const runsAscending = (catalog.runs || [])
    .slice()
    .sort((left, right) => left.date.localeCompare(right.date) || left.runId.localeCompare(right.runId));
  const selectedRuns = runsAscending.filter((run) => run.date >= startDate && run.date <= endDate && getTarget(run, targetId));
  if (!selectedRuns.length) throw new Error('No snapshot data exists for the selected page and period.');

  const ga4 = await queryGa4Metrics({ targetId, startDate, endDate });
  const records = await buildElementRecords(selectedRuns, targetId, ga4);
  const latestRun = selectedRuns.at(-1);
  const latestTarget = getTarget(latestRun, targetId);
  const groups = buildGroups(records, ga4);

  return {
    dashboardLogic: {
      purpose:
        'T world Shop 메인페이지의 클릭 요소가 자주 바뀌고 각 요소의 ga_action/ga_label 및 GA4 성과를 파악하기 어려운 문제를 줄이기 위한 대시보드입니다.',
      snapshotRule:
        '봇이 매일 오전 10시 Asia/Seoul 기준으로 PC/MO 메인페이지 HTML과 클릭 어트리뷰트 요소를 저장합니다. 팝업은 검사 대상에서 제외합니다.',
      scopeRule:
        '수집 대상은 GNB/푸터를 제외한 콘텐츠 영역의 ga_action/ga_label 요소입니다.',
      periodRule:
        '유지기간은 데이터 조회 기간 안에서 같은 ga_action/ga_label 조합이 발견되어 유지된 날짜 구간이며 YYYY-MM-DD ~ YYYY-MM-DD 형식입니다. 예를 들어 2026-06-29 ~ 2026-06-29는 선택한 데이터 조회 기간 안에서 그 요소가 2026-06-29에만 관찰되었다는 뜻이지, 실제 서비스에서 그 요소가 2026-06-29에 처음 노출되었다는 뜻이 아닙니다.',
      rowRule:
        '표의 행은 같은 ga_action/ga_label 조합과 유지기간을 가진 요소를 병합할 수 있으며, occurrences에는 해당 요소의 실제 발견 위치가 들어갑니다.',
      previewRule:
        '기본 왼쪽 화면은 선택 기간 안의 최신 캡처본입니다. 최신 캡처본에 없는 요소를 선택하면 그 요소가 존재하던 기간의 최신 캡처본을 보여줍니다.',
      metricsRule:
        'GA4 eventCount/session/user는 선택 기간과 페이지 기준으로 조회합니다. eventName=click, PC는 event_category=TWD_main, MO는 event_category=MTWD_main 및 hostName=m.shop.tworld.co.kr 조건입니다.',
      aiRule:
        'AI는 제공된 JSON에 있는 숫자와 위치 정보만 근거로 분석해야 하며, 데이터에 없는 사실을 추측하면 안 됩니다.',
    },
    page: {
      site: 'tworld-shop',
      company: 'SKT',
      service: 'T world Shop',
      market: 'KR',
      requestedUrl: latestTarget?.url || '',
      finalUrl: latestTarget?.finalUrl || '',
      targetId,
      targetLabel: latestTarget?.label || targetId,
      period: `${startDate} ~ ${endDate}`,
      days: selectedRuns.length,
      dates: selectedRuns.map((run) => run.date),
      latestSnapshotDate: latestRun?.date || '',
      latestRunId: latestRun?.runId || '',
      viewport: latestTarget?.page || {},
    },
    ga4: {
      propertyId: ga4.propertyId,
      accountId: ga4.accountId,
      eventName: ga4.eventName,
      eventCategory: ga4.eventCategory,
      hostname: ga4.hostname || '',
      totals: ga4.totals,
      rowCount: ga4.rowCount || 0,
    },
    groups,
    elements: records,
  };
}

async function buildElementRecords(runs, targetId, ga4) {
  const selectedDates = runs.map((run) => run.date);
  const recordsByKey = new Map();

  for (const run of runs) {
    const target = getTarget(run, targetId);
    if (!target) continue;
    const elements = await readTargetDomElements(target);
    const page = target.page || {};

    for (const element of elements) {
      const action = element.ga_action || '(missing)';
      const label = element.ga_label || '';
      const key = element.periodKey || element.stableKey || [targetId, action, label, element.href].join('|');
      const metricKey = makeGa4MetricKey(action, label);
      let record = recordsByKey.get(key);

      if (!record) {
        record = {
          key,
          metricKey,
          tracking: { action, label },
          href: element.href || '',
          occurrences: [],
        };
        recordsByKey.set(key, record);
      }

      record.occurrences.push({
        date: run.date,
        runId: run.runId,
        snapshotId: element.snapshotId || '',
        sourceIndex: element.sourceIndex || element.index || 0,
        text: cleanText(element.text || ''),
        href: element.href || '',
        tag: element.clickableTag || element.labelTag || '',
        selector: shortSelector(element.clickableSelector || element.selector || ''),
        status: element.status || '',
        visible: Boolean(element.visible),
        inViewport: Boolean(element.inViewport),
        position: summarizePosition(element.clickableBBox || element.labelBBox || {}, page),
      });
    }
  }

  const unmerged = Array.from(recordsByKey.values());
  for (const record of unmerged) {
    record.occurrences.sort(compareOccurrences);
    record.latestOccurrence = latestOccurrence(record.occurrences);
    record.periods = buildDatePeriods(record.occurrences, selectedDates);
    record.periodText = formatPeriods(record.periods);
  }

  const mergedByKey = new Map();
  for (const record of unmerged) {
    const mergeKey = `${record.metricKey}:${record.periodText}`;
    let merged = mergedByKey.get(mergeKey);
    if (!merged) {
      merged = {
        key: `merged:${mergeKey}`,
        metricKey: record.metricKey,
        tracking: { ...record.tracking },
        hrefs: new Set(),
        occurrences: [],
        periods: record.periods,
        periodText: record.periodText,
      };
      mergedByKey.set(mergeKey, merged);
    }
    if (record.href) merged.hrefs.add(record.href);
    merged.occurrences.push(...record.occurrences);
  }

  const records = Array.from(mergedByKey.values());
  for (const record of records) {
    record.occurrences.sort(compareOccurrences);
    record.latestOccurrence = latestOccurrence(record.occurrences);
    record.currentOccurrenceCount = record.occurrences.filter((item) => item.runId === record.latestOccurrence?.runId).length;
    record.href = record.hrefs.size === 1 ? Array.from(record.hrefs)[0] : record.hrefs.size > 1 ? 'multiple' : '';
    record.metrics = metricsForRecord(record, ga4);
    record.ux = summarizeRecordUx(record);
    delete record.hrefs;
  }

  records.sort((left, right) => {
    const eventCompare = metricNumber(right.metrics.eventCount) - metricNumber(left.metrics.eventCount);
    if (eventCompare) return eventCompare;
    const sessionCompare = metricNumber(right.metrics.sessions) - metricNumber(left.metrics.sessions);
    if (sessionCompare) return sessionCompare;
    return Number(left.latestOccurrence?.sourceIndex || 0) - Number(right.latestOccurrence?.sourceIndex || 0);
  });

  return records;
}

async function readTargetDomElements(target) {
  const jsonPath = target.domJsonPath || target.elementsPath;
  if (!jsonPath) return [];
  const payload = await readJsonFile(path.join(SNAPSHOTS_ROOT, jsonPath));
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.elements)) return payload.elements;
  return [];
}

function metricsForRecord(record, ga4) {
  const metrics = ga4.metrics?.[record.metricKey] || emptyMetrics();
  return {
    eventCount: Number(metrics.eventCount || 0),
    sessions: Number(metrics.sessions || 0),
    activeUsers: Number(metrics.activeUsers || 0),
  };
}

function buildGroups(records, ga4) {
  const groupsByKey = new Map();

  for (const record of records) {
    const action = record.tracking.action || '(missing)';
    let group = groupsByKey.get(action);
    if (!group) {
      group = {
        key: action,
        action,
        itemCount: 0,
        metrics: emptyMetrics(),
        metricKeys: new Set(),
      };
      groupsByKey.set(action, group);
    }

    group.itemCount += 1;
    if (!group.metricKeys.has(record.metricKey)) {
      group.metricKeys.add(record.metricKey);
      group.metrics.eventCount += Number(record.metrics.eventCount || 0);
      group.metrics.sessions += Number(record.metrics.sessions || 0);
      group.metrics.activeUsers += Number(record.metrics.activeUsers || 0);
    }
  }

  return Array.from(groupsByKey.values())
    .map((group) => {
      const { metricKeys, ...rest } = group;
      return rest;
    })
    .sort((left, right) => right.metrics.eventCount - left.metrics.eventCount);
}

async function generateGeminiInsight(analysis) {
  const geminiCredentialFile = await findGeminiCredentialFile();
  const ai = new GoogleGenAI({
    vertexai: true,
    project: GEMINI_PROJECT,
    location: GEMINI_LOCATION,
    ...(geminiCredentialFile ? { googleAuthOptions: { keyFilename: geminiCredentialFile } } : {}),
  });
  const response = await generateGeminiContentWithRetry(ai, {
    model: GEMINI_MODEL,
    contents: [
      {
        role: 'user',
        parts: [{ text: buildPrompt(analysis) }],
      },
    ],
    config: {
      temperature: 0.25,
      maxOutputTokens: MAX_OUTPUT_TOKENS,
      responseMimeType: 'application/json',
    },
  });
  return parseGeminiJson(response.text || '');
}

async function findGeminiCredentialFile() {
  if (GEMINI_APPLICATION_CREDENTIALS) {
    return path.resolve(GEMINI_APPLICATION_CREDENTIALS);
  }

  const candidates = [
    path.resolve('/run/secrets/gemini-key.json'),
    path.resolve(process.cwd(), 'gyutae-test-project-f714548c9b52.json'),
    path.resolve(process.cwd(), '..', 'gyutae-test-project-f714548c9b52.json'),
  ];

  for (const candidate of candidates) {
    if (await fileExists(candidate)) return candidate;
  }

  const parentEntries = await fs.readdir(path.resolve(process.cwd(), '..')).catch(() => []);
  const keyFile = parentEntries.find((entry) => /^gyutae-test-project-.*\.json$/i.test(entry));
  return keyFile ? path.resolve(process.cwd(), '..', keyFile) : null;
}

async function generateGeminiContentWithRetry(ai, params) {
  let lastError = null;

  for (let attempt = 1; attempt <= GEMINI_RETRY_ATTEMPTS; attempt += 1) {
    try {
      return await ai.models.generateContent(params);
    } catch (error) {
      lastError = error;
      if (!isRetryableGeminiError(error) || attempt >= GEMINI_RETRY_ATTEMPTS) break;
      await delay(GEMINI_RETRY_DELAY_MS * attempt);
    }
  }

  throw formatGeminiError(lastError);
}

function buildPrompt(analysis) {
  return [
    ...PROMPT_INSTRUCTIONS,
    '출력 스키마:',
    JSON.stringify(PROMPT_OUTPUT_SCHEMA, null, 2),
    '분석 데이터:',
    JSON.stringify(analysis),
  ].join('\n\n');
}

function parseGeminiJson(text) {
  const trimmed = String(text || '').trim().replace(/^```json\s*/i, '').replace(/```$/i, '').trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    return {
      headline: 'Gemini 응답을 JSON으로 해석하지 못했습니다.',
      summary: [trimmed.slice(0, 2000)],
      uxInsights: [],
      metricInsights: [],
      sectionInsights: [],
      changes: [],
      watchouts: ['응답 형식 오류가 있어 원문 일부만 표시합니다.'],
      actionItems: [],
    };
  }
}

function summarizeAnalysisForResponse(analysis) {
  return {
    page: analysis.page,
    totals: analysis.ga4.totals,
    groupCount: analysis.groups.length,
    elementCount: analysis.elements.length,
  };
}

function summarizePosition(bbox, page) {
  const x = roundNumber(bbox.x);
  const y = roundNumber(bbox.y);
  const width = roundNumber(bbox.width);
  const height = roundNumber(bbox.height);
  const viewportHeight = Number(page.viewportHeight || 0);
  const documentHeight = Number(page.documentHeight || 0);
  const centerY = y + height / 2;
  const aboveFold = viewportHeight > 0 ? y < viewportHeight : false;

  return {
    x,
    y,
    width,
    height,
    areaPx: roundNumber(width * height),
    screenZone: screenZone(centerY, documentHeight),
    aboveFold,
    verticalOrderHint: y,
  };
}

function summarizeRecordUx(record) {
  const latest = record.latestOccurrence || {};
  return {
    latestText: latest.text || '',
    latestStatus: latest.status || '',
    latestPosition: latest.position || {},
    firstSeen: record.periods[0]?.start || '',
    lastSeen: record.periods.at(-1)?.end || '',
    occurrenceCountInLatestSnapshot: record.currentOccurrenceCount || 0,
  };
}

function screenZone(centerY, documentHeight) {
  if (!Number.isFinite(centerY)) return 'unknown';
  if (!documentHeight || documentHeight <= 0) {
    if (centerY < 900) return 'top';
    if (centerY < 2200) return 'middle';
    return 'bottom';
  }
  const ratio = centerY / documentHeight;
  if (ratio < 0.25) return 'top';
  if (ratio < 0.65) return 'middle';
  return 'bottom';
}

function buildDatePeriods(occurrences, selectedDates) {
  const occurrenceDates = new Set(occurrences.map((item) => item.date));
  const periods = [];
  let start = null;
  let end = null;

  for (const date of selectedDates) {
    if (occurrenceDates.has(date)) {
      if (!start) start = date;
      end = date;
    } else if (start) {
      periods.push({ start, end });
      start = null;
      end = null;
    }
  }

  if (start) periods.push({ start, end });
  return periods;
}

function formatPeriods(periods) {
  return periods.map((period) => `${period.start} ~ ${period.end}`).join(', ');
}

function latestOccurrence(occurrences) {
  const latestDate = occurrences.at(-1)?.date || '';
  return occurrences.filter((item) => item.date === latestDate).sort(compareOccurrences)[0] || occurrences.at(-1) || null;
}

function compareOccurrences(left, right) {
  return (
    left.date.localeCompare(right.date) ||
    left.runId.localeCompare(right.runId) ||
    Number(left.sourceIndex || 0) - Number(right.sourceIndex || 0) ||
    String(left.snapshotId || '').localeCompare(String(right.snapshotId || ''))
  );
}

function getTarget(run, targetId) {
  return run?.targets?.find((target) => target.id === targetId) || null;
}

function getInsightCachePath({ targetId, startDate, endDate }) {
  const key = `${CACHE_VERSION}:${targetId}:${startDate}:${endDate}`;
  const digest = crypto.createHash('sha1').update(key).digest('hex').slice(0, 16);
  return path.join(INSIGHTS_CACHE_DIR, `${targetId}-${startDate}-${endDate}-${digest}.json`);
}

function emptyMetrics() {
  return { eventCount: 0, sessions: 0, activeUsers: 0 };
}

function metricNumber(value) {
  return value === null || value === undefined ? -1 : Number(value || 0);
}

function cleanText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, 240);
}

function shortSelector(value) {
  return String(value || '').slice(0, 360);
}

function roundNumber(value) {
  const number = Number(value || 0);
  if (!Number.isFinite(number)) return 0;
  return Math.round(number * 100) / 100;
}

async function readJsonFile(filePath) {
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf8'));
  } catch {
    return null;
  }
}

async function fileExists(filePath) {
  try {
    const stat = await fs.stat(filePath);
    return stat.isFile();
  } catch {
    return false;
  }
}

function validateDate(value, name) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) {
    throw new Error(`${name} must be YYYY-MM-DD.`);
  }
}

function positiveInteger(value, fallback) {
  const number = Number(value || fallback);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : fallback;
}

function isRetryableGeminiError(error) {
  const status = Number(error?.status || 0);
  const message = String(error?.message || '');
  return status === 429 || status === 503 || /RESOURCE_EXHAUSTED|UNAVAILABLE/i.test(message);
}

function formatGeminiError(error) {
  const status = Number(error?.status || 0);
  const message = String(error?.message || '');

  if (status === 429 || /RESOURCE_EXHAUSTED/i.test(message)) {
    return new Error('Gemini API 사용량 또는 일시적 처리 용량이 초과되었습니다. 잠시 후 다시 시도해 주세요. 같은 기간/페이지에서 한 번 성공하면 이후에는 캐시된 결과를 사용합니다.');
  }

  if (status === 403 || /PERMISSION_DENIED|aiplatform\.endpoints\.predict/i.test(message)) {
    return new Error('Gemini 호출 권한이 없습니다. GEMINI_APPLICATION_CREDENTIALS에 지정한 서비스 계정이 gyutae-test-project의 Vertex AI 호출 권한을 가지고 있는지 확인해야 합니다.');
  }

  return error instanceof Error ? error : new Error(message || 'Gemini 인사이트를 생성하지 못했습니다.');
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
