import { GoogleGenAI } from '@google/genai';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { makeGa4MetricKey, queryGa4Metrics } from './ga4-data-api.mjs';
import { canonicalTrackingBase } from './skt-tracking-normalization.mjs';

const SNAPSHOTS_ROOT = path.resolve('snapshots');
const INPUT_SCHEMA_VERSION = 'compact-observations-v2';
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
  'elements에는 모든 표 행이 들어 있고 observations.instances에는 같은 행으로 병합된 실제 클릭 요소별 관찰 정보가 압축되어 있다. 모든 클릭 요소와 위치/유지기간/GA4 수치를 빠짐없이 고려해라.',
  'observations의 위치 범위와 materialChanges는 날짜별 중복 좌표를 압축한 값이다. 값이 없다는 이유로 변화가 없었다고 단정하지 마라.',
  '각 섹션에는 가능한 한 구체적인 수치를 포함해라.',
  '반드시 JSON만 출력해라. 마크다운 코드블록은 쓰지 마라.',
]);
const CHUNK_PROMPT_INSTRUCTIONS = Object.freeze([
  '아래 데이터는 전체 SKT T world Shop 분석 데이터를 토큰 한도에 맞춰 나눈 일부다.',
  '제공된 모든 클릭 요소와 실제 요소 인스턴스를 검토하고, 이 조각에서 확인되는 사실만 JSON으로 정리해라.',
  '다른 조각의 데이터는 추측하지 마라. 최종 통합 분석기가 여러 조각의 결과를 합칠 것이다.',
]);
const SYNTHESIS_PROMPT_INSTRUCTIONS = Object.freeze([
  '아래 JSON에는 같은 조회의 전체 영역 합계와 모든 데이터 조각의 분석 결과가 들어 있다.',
  '모든 조각을 빠짐없이 통합하고 중복되는 관찰은 합쳐 최종 SKT T world Shop 인사이트를 작성해라.',
  '조각별 표현을 그대로 나열하지 말고 전체 페이지 관점에서 영역과 수치를 비교해라.',
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
const FOLLOW_UP_INSTRUCTIONS = Object.freeze([
  '너는 SKT T world Shop 메인페이지 대시보드의 후속 질문에 답하는 한국어 데이터 분석가다.',
  'analysis가 원본 근거이고 originalInsight는 앞서 생성한 요약이다. 두 값이 충돌하면 analysis를 우선해라.',
  '질문에 직접 답하고, 관련 ga_action/ga_label, GA4 수치, 유지기간, 요소 위치를 가능한 한 구체적으로 제시해라.',
  '유지기간은 조회 기간 안에서 관찰된 구간일 뿐 실제 서비스의 최초 또는 최종 노출일이 아님을 지켜라.',
  '캐러셀의 hidden/offscreen/inViewport 값만으로 실제 노출이나 스와이프 행동을 단정하지 마라.',
  '데이터에 없는 전환, 매출, 구매 의도, 선호도, 원인을 추측하지 마라.',
  '질문에 답할 근거가 없으면 확인할 수 없다고 명확히 말해라.',
  '답변은 간결한 한국어로 쓰고 반드시 JSON만 출력해라. 마크다운 코드블록은 쓰지 마라.',
]);
const FOLLOW_UP_CHUNK_INSTRUCTIONS = Object.freeze([
  '아래 데이터는 전체 클릭 요소 중 일부다.',
  '질문과 직접 관련된 근거를 이 조각에서 모두 찾아라. 관련 근거가 없으면 answer를 빈 문자열로 두고 relevance를 false로 설정해라.',
  '다른 데이터 조각은 추측하지 마라. 이후 통합 단계에서 모든 조각의 답변을 합친다.',
]);
const FOLLOW_UP_SYNTHESIS_INSTRUCTIONS = Object.freeze([
  '아래 JSON에는 같은 질문에 대한 모든 데이터 조각의 검토 결과가 들어 있다.',
  '관련 있는 모든 조각의 근거를 합치고 중복을 제거해 하나의 최종 답변을 작성해라.',
  '조각 번호나 분할 처리 사실은 사용자 답변에 언급하지 마라.',
]);
const FOLLOW_UP_OUTPUT_SCHEMA = Object.freeze({
  answer: '질문에 대한 직접적인 한국어 답변',
  evidence: ['답변을 뒷받침하는 구체적인 요소/수치/기간 근거 0~6개'],
  caveats: ['해석 시 주의할 점 0~3개'],
  suggestedQuestions: ['현재 데이터로 이어서 물어볼 만한 짧은 질문 0~3개'],
});
const FOLLOW_UP_CHUNK_OUTPUT_SCHEMA = Object.freeze({
  relevance: '질문과 관련된 근거가 있으면 true, 없으면 false',
  answer: '이 데이터 조각에서 확인되는 질문 관련 답변',
  evidence: ['구체적인 요소/수치/기간 근거'],
  caveats: ['해석 시 주의할 점'],
});
const PROMPT_VERSION = crypto
  .createHash('sha1')
  .update(
    JSON.stringify({
      inputSchema: INPUT_SCHEMA_VERSION,
      instructions: PROMPT_INSTRUCTIONS,
      chunkInstructions: CHUNK_PROMPT_INSTRUCTIONS,
      synthesisInstructions: SYNTHESIS_PROMPT_INSTRUCTIONS,
      outputSchema: PROMPT_OUTPUT_SCHEMA,
    }),
  )
  .digest('hex')
  .slice(0, 12);
const FOLLOW_UP_VERSION = crypto
  .createHash('sha1')
  .update(
    JSON.stringify({
      instructions: FOLLOW_UP_INSTRUCTIONS,
      chunkInstructions: FOLLOW_UP_CHUNK_INSTRUCTIONS,
      synthesisInstructions: FOLLOW_UP_SYNTHESIS_INSTRUCTIONS,
      outputSchema: FOLLOW_UP_OUTPUT_SCHEMA,
      chunkOutputSchema: FOLLOW_UP_CHUNK_OUTPUT_SCHEMA,
    }),
  )
  .digest('hex')
  .slice(0, 12);
const INSIGHTS_CACHE_DIR = path.join(SNAPSHOTS_ROOT, 'ai-insights');
const FOLLOW_UP_CACHE_DIR = path.join(SNAPSHOTS_ROOT, 'ai-follow-ups');
const GEMINI_PROJECT = process.env.GEMINI_PROJECT_ID || process.env.GOOGLE_CLOUD_PROJECT || process.env.GCP_PROJECT_ID || 'gyutae-test-project';
const GEMINI_LOCATION = process.env.GEMINI_LOCATION || process.env.GOOGLE_CLOUD_LOCATION || 'global';
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-3.1-pro-preview';
const GEMINI_APPLICATION_CREDENTIALS = process.env.GEMINI_APPLICATION_CREDENTIALS || process.env.GEMINI_GOOGLE_APPLICATION_CREDENTIALS || '';
const MAX_OUTPUT_TOKENS = positiveInteger(process.env.GEMINI_INSIGHTS_MAX_OUTPUT_TOKENS, 16_384);
const MAX_INPUT_TOKENS = positiveInteger(process.env.GEMINI_INSIGHTS_MAX_INPUT_TOKENS, 400_000);
const CHUNK_INPUT_TOKENS = Math.min(
  MAX_INPUT_TOKENS,
  positiveInteger(process.env.GEMINI_INSIGHTS_CHUNK_INPUT_TOKENS, 240_000),
);
const GEMINI_RETRY_ATTEMPTS = positiveInteger(process.env.GEMINI_INSIGHTS_RETRY_ATTEMPTS, 3);
const GEMINI_RETRY_DELAY_MS = positiveInteger(process.env.GEMINI_INSIGHTS_RETRY_DELAY_MS, 12_000);
const CACHE_VERSION = `v2:${GEMINI_MODEL}:${INPUT_SCHEMA_VERSION}:${PROMPT_VERSION}`;
const FOLLOW_UP_CACHE_VERSION = `v1:${GEMINI_MODEL}:${INPUT_SCHEMA_VERSION}:${FOLLOW_UP_VERSION}`;
const MAX_FOLLOW_UP_QUESTION_LENGTH = 1_000;
const MAX_FOLLOW_UP_HISTORY_MESSAGES = 8;
const MAX_FOLLOW_UP_HISTORY_CONTENT_LENGTH = 3_000;

export async function queryAiInsights({ targetId, startDate, endDate }) {
  validateDate(startDate, 'startDate');
  validateDate(endDate, 'endDate');
  if (!targetId) throw new Error('targetId is required.');
  if (startDate > endDate) throw new Error('startDate must be earlier than or equal to endDate.');

  const cachePath = getInsightCachePath({ targetId, startDate, endDate });
  const cached = await readJsonFile(cachePath);
  if (cached) return { ...cached, cached: true };

  const analysis = await buildInsightInput({ targetId, startDate, endDate });
  const generation = await generateGeminiInsight(analysis);
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
    summary: {
      ...summarizeAnalysisForResponse(analysis),
      analysisMode: generation.mode,
      inputTokens: generation.inputTokens,
      chunkCount: generation.chunkCount,
    },
    insight: generation.insight,
  };

  await fs.mkdir(path.dirname(cachePath), { recursive: true });
  await Promise.all([
    fs.writeFile(cachePath, `${JSON.stringify(payload, null, 2)}\n`),
    fs.writeFile(getInsightAnalysisPath(cachePath), `${JSON.stringify(analysis)}\n`),
  ]);
  return payload;
}

export async function queryAiFollowUp({ targetId, startDate, endDate, question, history = [] }) {
  validateDate(startDate, 'startDate');
  validateDate(endDate, 'endDate');
  if (!targetId) throw new Error('targetId is required.');
  if (startDate > endDate) throw new Error('startDate must be earlier than or equal to endDate.');

  const normalizedQuestion = normalizeFollowUpQuestion(question);
  const normalizedHistory = normalizeFollowUpHistory(history);
  const followUpCachePath = getFollowUpCachePath({
    targetId,
    startDate,
    endDate,
    question: normalizedQuestion,
    history: normalizedHistory,
  });
  const cached = await readJsonFile(followUpCachePath);
  if (cached) return { ...cached, cached: true };

  const originalInsight = await queryAiInsights({ targetId, startDate, endDate });
  const insightCachePath = getInsightCachePath({ targetId, startDate, endDate });
  const analysisPath = getInsightAnalysisPath(insightCachePath);
  let analysis = await readJsonFile(analysisPath);
  if (!analysis) {
    analysis = await buildInsightInput({ targetId, startDate, endDate });
    await fs.mkdir(path.dirname(analysisPath), { recursive: true });
    await fs.writeFile(analysisPath, `${JSON.stringify(analysis)}\n`);
  }

  const ai = await createGeminiClient();
  const generation = await generateGeminiFollowUp(ai, {
    analysis,
    originalInsight: {
      summary: originalInsight.summary || {},
      insight: originalInsight.insight || {},
    },
    question: normalizedQuestion,
    history: normalizedHistory,
  });
  const payload = {
    status: 'ok',
    cached: false,
    cacheVersion: FOLLOW_UP_CACHE_VERSION,
    generatedAt: new Date().toISOString(),
    provider: 'vertex-ai',
    model: GEMINI_MODEL,
    targetId,
    startDate,
    endDate,
    question: normalizedQuestion,
    mode: generation.mode,
    inputTokens: generation.inputTokens,
    chunkCount: generation.chunkCount,
    response: generation.response,
  };

  await fs.mkdir(path.dirname(followUpCachePath), { recursive: true });
  await fs.writeFile(followUpCachePath, `${JSON.stringify(payload, null, 2)}\n`);
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
        '표의 행은 같은 ga_action/ga_label 조합과 유지기간을 가진 요소를 병합할 수 있으며, observations.instances에는 병합된 실제 요소별 관찰 기간과 위치가 들어갑니다.',
      previewRule:
        '기본 왼쪽 화면은 선택 기간 안의 최신 캡처본입니다. 최신 캡처본에 없는 요소를 선택하면 그 요소가 존재하던 기간의 최신 캡처본을 보여줍니다.',
      metricsRule:
        'GA4 eventCount/session/user는 선택 기간과 페이지 기준으로 조회합니다. eventName=click, PC는 event_category=TWD_main, MO는 event_category=MTWD_main 및 hostName=m.shop.tworld.co.kr 조건입니다.',
      aiRule:
        'AI는 제공된 JSON에 있는 숫자와 위치 정보만 근거로 분석해야 하며, 날짜별 중복 관찰은 요소별 기간과 위치 범위 및 중요한 변경점으로 압축됩니다.',
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
      firstSnapshotDate: selectedRuns[0]?.date || '',
      latestSnapshotDate: latestRun?.date || '',
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
    const identityCounts = new Map();

    for (const element of elements) {
      const canonical = canonicalTrackingBase({
        targetId,
        date: run.date,
        action: element.ga_action,
        label: element.ga_label,
        href: element.href,
      });
      const action = canonical.action;
      const label = canonical.label;
      const ordinal = (identityCounts.get(canonical.identity) || 0) + 1;
      identityCounts.set(canonical.identity, ordinal);
      const key = `${canonical.identity}|${ordinal}`;
      const metricKey = makeGa4MetricKey(action, label);
      let record = recordsByKey.get(key);

      if (!record) {
        record = {
          key,
          metricKey,
          tracking: { action, label },
          href: element.href || '',
          rawActions: new Set(),
          occurrences: [],
        };
        recordsByKey.set(key, record);
      }

      record.rawActions.add(canonical.rawAction);
      record.occurrences.push({
        date: run.date,
        instanceKey: key,
        sourceIndex: element.sourceIndex || element.index || 0,
        text: cleanText(element.text || ''),
        tag: element.clickableTag || element.labelTag || '',
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
        rawActions: new Set(),
        occurrences: [],
        periods: record.periods,
        periodText: record.periodText,
      };
      mergedByKey.set(mergeKey, merged);
    }
    if (record.href) merged.hrefs.add(record.href);
    for (const rawAction of record.rawActions) merged.rawActions.add(rawAction);
    merged.occurrences.push(...record.occurrences);
  }

  const records = Array.from(mergedByKey.values());
  for (const record of records) {
    record.occurrences.sort(compareOccurrences);
    record.latestOccurrence = latestOccurrence(record.occurrences);
    record.currentOccurrenceCount = record.occurrences.filter((item) => item.date === record.latestOccurrence?.date).length;
    record.href = record.hrefs.size === 1 ? Array.from(record.hrefs)[0] : record.hrefs.size > 1 ? 'multiple' : '';
    record.metrics = metricsForRecord(record, ga4);
    record.ux = summarizeRecordUx(record);
    record.observations = summarizeOccurrences(record.occurrences);
    record.correctedRawActions = Array.from(record.rawActions)
      .filter((action) => action !== record.tracking.action)
      .sort();
    delete record.hrefs;
    delete record.rawActions;
  }

  records.sort((left, right) => {
    const eventCompare = metricNumber(right.metrics.eventCount) - metricNumber(left.metrics.eventCount);
    if (eventCompare) return eventCompare;
    const sessionCompare = metricNumber(right.metrics.sessions) - metricNumber(left.metrics.sessions);
    if (sessionCompare) return sessionCompare;
    return Number(left.latestOccurrence?.sourceIndex || 0) - Number(right.latestOccurrence?.sourceIndex || 0);
  });

  return records.map((record) => {
    const { key, occurrences, latestOccurrence, currentOccurrenceCount, ...insightRecord } = record;
    return insightRecord;
  });
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
  const ai = await createGeminiClient();
  const prompt = buildPrompt(analysis);
  const promptTokens = await countPromptTokens(ai, prompt);
  if (promptTokens <= MAX_INPUT_TOKENS) {
    return {
      insight: await generatePromptInsight(ai, prompt),
      mode: 'single',
      inputTokens: promptTokens,
      chunkCount: 1,
    };
  }

  return generateChunkedGeminiInsight(ai, analysis);
}

async function createGeminiClient() {
  const geminiCredentialFile = await findGeminiCredentialFile();
  return new GoogleGenAI({
    vertexai: true,
    project: GEMINI_PROJECT,
    location: GEMINI_LOCATION,
    ...(geminiCredentialFile ? { googleAuthOptions: { keyFilename: geminiCredentialFile } } : {}),
  });
}

async function generateChunkedGeminiInsight(ai, analysis) {
  const chunks = await splitElementsToFit(ai, analysis, analysis.elements);
  const chunkResults = [];
  let inputTokens = 0;

  for (const [index, elements] of chunks.entries()) {
    const chunkAnalysis = analysisForElements(analysis, elements, {
      index: index + 1,
      count: chunks.length,
    });
    const prompt = buildChunkPrompt(chunkAnalysis);
    const tokenCount = await countPromptTokens(ai, prompt);
    inputTokens += tokenCount;
    chunkResults.push({
      index: index + 1,
      elementCount: elements.length,
      actions: Array.from(new Set(elements.map((record) => record.tracking.action))),
      insight: await generatePromptInsight(ai, prompt),
    });
  }

  const synthesisData = {
    dashboardLogic: analysis.dashboardLogic,
    page: analysis.page,
    ga4: analysis.ga4,
    groups: analysis.groups,
    coveredElementCount: analysis.elements.length,
    chunkCount: chunkResults.length,
    chunkResults,
  };
  const synthesisPrompt = buildSynthesisPrompt(synthesisData);
  const synthesisTokens = await countPromptTokens(ai, synthesisPrompt);
  if (synthesisTokens > MAX_INPUT_TOKENS) {
    throw new Error('Gemini 분할 분석 결과도 입력 한도를 초과했습니다. 조회 기간을 나누어 분석해 주세요.');
  }

  inputTokens += synthesisTokens;
  return {
    insight: await generatePromptInsight(ai, synthesisPrompt),
    mode: 'chunked',
    inputTokens,
    chunkCount: chunks.length,
  };
}

async function generateGeminiFollowUp(ai, context) {
  const prompt = buildFollowUpPrompt(context);
  const promptTokens = await countPromptTokens(ai, prompt);
  if (promptTokens <= MAX_INPUT_TOKENS) {
    return {
      response: await generatePromptFollowUp(ai, prompt),
      mode: 'single',
      inputTokens: promptTokens,
      chunkCount: 1,
    };
  }

  const chunks = await splitFollowUpElementsToFit(ai, context, context.analysis.elements);
  const chunkResults = [];
  let inputTokens = 0;

  for (const [index, elements] of chunks.entries()) {
    const chunkContext = followUpContextForElements(context, elements, {
      index: index + 1,
      count: chunks.length,
    });
    const chunkPrompt = buildFollowUpChunkPrompt(chunkContext);
    const tokenCount = await countPromptTokens(ai, chunkPrompt);
    inputTokens += tokenCount;
    chunkResults.push({
      index: index + 1,
      actions: Array.from(new Set(elements.map((record) => record.tracking.action))),
      elementCount: elements.length,
      response: await generatePromptFollowUpChunk(ai, chunkPrompt),
    });
  }

  const synthesisData = {
    question: context.question,
    history: context.history,
    originalInsight: context.originalInsight,
    page: context.analysis.page,
    ga4: context.analysis.ga4,
    groups: context.analysis.groups,
    coveredElementCount: context.analysis.elements.length,
    chunkCount: chunkResults.length,
    chunkResults,
  };
  const synthesisPrompt = buildFollowUpSynthesisPrompt(synthesisData);
  const synthesisTokens = await countPromptTokens(ai, synthesisPrompt);
  if (synthesisTokens > MAX_INPUT_TOKENS) {
    throw new Error('후속 질문의 분할 분석 결과가 입력 한도를 초과했습니다. 질문 범위를 조금 더 구체적으로 작성해 주세요.');
  }

  inputTokens += synthesisTokens;
  return {
    response: await generatePromptFollowUp(ai, synthesisPrompt),
    mode: 'chunked',
    inputTokens,
    chunkCount: chunks.length,
  };
}

async function splitFollowUpElementsToFit(ai, context, elements, tokenBudget = CHUNK_INPUT_TOKENS) {
  const prompt = buildFollowUpChunkPrompt(followUpContextForElements(context, elements, { index: 1, count: 1 }));
  const tokenCount = await countPromptTokens(ai, prompt);
  if (tokenCount <= tokenBudget) return [elements];
  if (elements.length <= 1) {
    throw new Error('단일 클릭 요소의 후속 질문 입력이 허용 크기를 초과했습니다.');
  }

  const midpoint = Math.ceil(elements.length / 2);
  const left = await splitFollowUpElementsToFit(ai, context, elements.slice(0, midpoint), tokenBudget);
  const right = await splitFollowUpElementsToFit(ai, context, elements.slice(midpoint), tokenBudget);
  return [...left, ...right];
}

function followUpContextForElements(context, elements, chunk) {
  return {
    question: context.question,
    history: context.history,
    originalInsight: context.originalInsight,
    analysis: analysisForElements(context.analysis, elements, chunk),
  };
}

export async function splitElementsToFit(ai, analysis, elements, tokenBudget = CHUNK_INPUT_TOKENS) {
  const prompt = buildChunkPrompt(analysisForElements(analysis, elements, { index: 1, count: 1 }));
  const tokenCount = await countPromptTokens(ai, prompt);
  if (tokenCount <= tokenBudget) return [elements];
  if (elements.length <= 1) {
    throw new Error('단일 클릭 요소의 Gemini 입력이 허용 크기를 초과했습니다.');
  }

  const midpoint = Math.ceil(elements.length / 2);
  const left = await splitElementsToFit(ai, analysis, elements.slice(0, midpoint), tokenBudget);
  const right = await splitElementsToFit(ai, analysis, elements.slice(midpoint), tokenBudget);
  return [...left, ...right];
}

function analysisForElements(analysis, elements, chunk) {
  return {
    dashboardLogic: analysis.dashboardLogic,
    page: analysis.page,
    ga4: analysis.ga4,
    groups: buildGroups(elements),
    chunk: {
      ...chunk,
      elementCount: elements.length,
      totalElementCount: analysis.elements.length,
    },
    elements,
  };
}

async function generatePromptInsight(ai, prompt) {
  return generatePromptJson(ai, prompt, parseGeminiJson);
}

async function generatePromptFollowUp(ai, prompt) {
  return generatePromptJson(ai, prompt, parseFollowUpJson);
}

async function generatePromptFollowUpChunk(ai, prompt) {
  return generatePromptJson(ai, prompt, parseFollowUpChunkJson);
}

async function generatePromptJson(ai, prompt, parser) {
  const response = await generateGeminiContentWithRetry(ai, {
    model: GEMINI_MODEL,
    contents: promptContents(prompt),
    config: {
      temperature: 0.2,
      maxOutputTokens: MAX_OUTPUT_TOKENS,
      responseMimeType: 'application/json',
      thinkingConfig: { thinkingLevel: 'HIGH' },
    },
  });
  return parser(response.text || '');
}

async function countPromptTokens(ai, prompt) {
  try {
    const response = await ai.models.countTokens({
      model: GEMINI_MODEL,
      contents: promptContents(prompt),
    });
    const totalTokens = Number(response.totalTokens || 0);
    if (Number.isFinite(totalTokens) && totalTokens > 0) return totalTokens;
  } catch {
    // A conservative local estimate still lets oversized prompts use the chunked path.
  }

  return estimatePromptTokens(prompt);
}

function promptContents(prompt) {
  return [
    {
      role: 'user',
      parts: [{ text: prompt }],
    },
  ];
}

export function estimatePromptTokens(prompt) {
  return Math.ceil(Buffer.byteLength(String(prompt || ''), 'utf8') / 3);
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
  return buildStructuredPrompt(PROMPT_INSTRUCTIONS, '분석 데이터:', analysis);
}

function buildChunkPrompt(analysis) {
  return buildStructuredPrompt([...PROMPT_INSTRUCTIONS, ...CHUNK_PROMPT_INSTRUCTIONS], '분할 분석 데이터:', analysis);
}

function buildSynthesisPrompt(synthesisData) {
  return buildStructuredPrompt([...PROMPT_INSTRUCTIONS, ...SYNTHESIS_PROMPT_INSTRUCTIONS], '통합 분석 데이터:', synthesisData);
}

function buildFollowUpPrompt(context) {
  return buildStructuredPrompt(FOLLOW_UP_INSTRUCTIONS, '후속 질문 데이터:', context, FOLLOW_UP_OUTPUT_SCHEMA);
}

function buildFollowUpChunkPrompt(context) {
  return buildStructuredPrompt(
    [...FOLLOW_UP_INSTRUCTIONS, ...FOLLOW_UP_CHUNK_INSTRUCTIONS],
    '후속 질문 분할 데이터:',
    context,
    FOLLOW_UP_CHUNK_OUTPUT_SCHEMA,
  );
}

function buildFollowUpSynthesisPrompt(synthesisData) {
  return buildStructuredPrompt(
    [...FOLLOW_UP_INSTRUCTIONS, ...FOLLOW_UP_SYNTHESIS_INSTRUCTIONS],
    '후속 질문 통합 데이터:',
    synthesisData,
    FOLLOW_UP_OUTPUT_SCHEMA,
  );
}

function buildStructuredPrompt(instructions, dataLabel, data, outputSchema = PROMPT_OUTPUT_SCHEMA) {
  return [
    ...instructions,
    '출력 스키마:',
    JSON.stringify(outputSchema, null, 2),
    dataLabel,
    JSON.stringify(data),
  ].join('\n\n');
}

function parseGeminiJson(text) {
  const { parsed, trimmed } = parseJsonResponse(text);
  if (!parsed) {
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
  return parsed;
}

function parseFollowUpJson(text) {
  const { parsed, trimmed } = parseJsonResponse(text);
  if (!parsed) {
    return {
      answer: trimmed.slice(0, 12_000) || 'Gemini 응답을 해석하지 못했습니다.',
      evidence: [],
      caveats: ['응답 형식 오류가 있어 원문만 표시합니다.'],
      suggestedQuestions: [],
    };
  }

  return {
    answer: String(parsed.answer || '').trim().slice(0, 12_000),
    evidence: stringArray(parsed.evidence, 6),
    caveats: stringArray(parsed.caveats, 3),
    suggestedQuestions: stringArray(parsed.suggestedQuestions, 3),
  };
}

function parseFollowUpChunkJson(text) {
  const { parsed, trimmed } = parseJsonResponse(text);
  if (!parsed) {
    return {
      relevance: Boolean(trimmed),
      answer: trimmed.slice(0, 8_000),
      evidence: [],
      caveats: ['응답 형식 오류가 있어 원문만 전달합니다.'],
    };
  }

  return {
    relevance: Boolean(parsed.relevance),
    answer: String(parsed.answer || '').trim().slice(0, 8_000),
    evidence: stringArray(parsed.evidence, 8),
    caveats: stringArray(parsed.caveats, 4),
  };
}

function parseJsonResponse(text) {
  const trimmed = String(text || '').trim().replace(/^```json\s*/i, '').replace(/```$/i, '').trim();
  try {
    return { parsed: JSON.parse(trimmed), trimmed };
  } catch {
    return { parsed: null, trimmed };
  }
}

function stringArray(value, limit) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => String(item || '').trim())
    .filter(Boolean)
    .slice(0, limit);
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
    observedDays: new Set(record.occurrences.map((item) => item.date)).size,
    periodCount: record.periods.length,
    occurrenceCountInLatestSnapshot: record.currentOccurrenceCount || 0,
  };
}

export function summarizeOccurrences(occurrences) {
  const sorted = occurrences.slice().sort(compareOccurrences);
  const instancesByKey = new Map();

  for (const occurrence of sorted) {
    const key = occurrence.instanceKey || String(occurrence.sourceIndex || 0);
    const instance = instancesByKey.get(key) || [];
    instance.push(occurrence);
    instancesByKey.set(key, instance);
  }

  const instances = Array.from(instancesByKey.values()).map((items) => {
    const latest = items.at(-1) || {};
    const changes = [];
    let previousSignature = '';

    for (const item of items) {
      const state = materialObservationState(item);
      const signature = JSON.stringify(state);
      if (signature === previousSignature) continue;
      previousSignature = signature;
      changes.push({ date: item.date, ...state });
    }

    return {
      firstSeen: items[0]?.date || '',
      lastSeen: latest.date || '',
      observedDays: new Set(items.map((item) => item.date)).size,
      sourceOrder: latest.sourceIndex || 0,
      latest: compactObservation(latest),
      positionRange: summarizePositionRange(items),
      materialChanges: changes,
    };
  });

  return {
    totalDailyObservations: sorted.length,
    observedDays: new Set(sorted.map((item) => item.date)).size,
    instanceCount: instances.length,
    positionRange: summarizePositionRange(sorted),
    instances,
  };
}

function compactObservation(occurrence) {
  return {
    date: occurrence.date || '',
    text: occurrence.text || '',
    tag: occurrence.tag || '',
    status: occurrence.status || '',
    visible: Boolean(occurrence.visible),
    inViewport: Boolean(occurrence.inViewport),
    position: occurrence.position || {},
  };
}

function materialObservationState(occurrence) {
  return {
    text: occurrence.text || '',
    tag: occurrence.tag || '',
    status: occurrence.status || '',
    visible: Boolean(occurrence.visible),
    inViewport: Boolean(occurrence.inViewport),
    screenZone: occurrence.position?.screenZone || 'unknown',
    aboveFold: Boolean(occurrence.position?.aboveFold),
  };
}

function summarizePositionRange(occurrences) {
  const positions = occurrences.map((item) => item.position || {}).filter((position) => Number.isFinite(Number(position.y)));
  if (!positions.length) return {};

  const values = (name) => positions.map((position) => Number(position[name] || 0));
  const range = (name) => {
    const numbers = values(name);
    return { min: roundNumber(Math.min(...numbers)), max: roundNumber(Math.max(...numbers)) };
  };

  return {
    x: range('x'),
    y: range('y'),
    width: range('width'),
    height: range('height'),
    screenZones: Array.from(new Set(positions.map((position) => position.screenZone || 'unknown'))),
    aboveFoldObservations: positions.filter((position) => position.aboveFold).length,
    visibleObservations: occurrences.filter((item) => item.visible).length,
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
    String(left.instanceKey || '').localeCompare(String(right.instanceKey || '')) ||
    Number(left.sourceIndex || 0) - Number(right.sourceIndex || 0) ||
    String(left.text || '').localeCompare(String(right.text || ''))
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

function getInsightAnalysisPath(cachePath) {
  return cachePath.replace(/\.json$/, '.analysis.json');
}

function getFollowUpCachePath({ targetId, startDate, endDate, question, history }) {
  const key = JSON.stringify({
    version: FOLLOW_UP_CACHE_VERSION,
    targetId,
    startDate,
    endDate,
    question,
    history,
  });
  const digest = crypto.createHash('sha1').update(key).digest('hex').slice(0, 20);
  return path.join(FOLLOW_UP_CACHE_DIR, `${targetId}-${startDate}-${endDate}-${digest}.json`);
}

export function normalizeFollowUpQuestion(value) {
  const question = String(value || '').replace(/\s+/g, ' ').trim();
  if (!question) throw new Error('question is required.');
  if (question.length > MAX_FOLLOW_UP_QUESTION_LENGTH) {
    throw new Error(`question must be ${MAX_FOLLOW_UP_QUESTION_LENGTH} characters or fewer.`);
  }
  return question;
}

export function normalizeFollowUpHistory(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((message) => {
      const role = message?.role === 'assistant' ? 'assistant' : message?.role === 'user' ? 'user' : '';
      const content = String(message?.content || '').replace(/\s+/g, ' ').trim().slice(0, MAX_FOLLOW_UP_HISTORY_CONTENT_LENGTH);
      return { role, content };
    })
    .filter((message) => message.role && message.content)
    .slice(-MAX_FOLLOW_UP_HISTORY_MESSAGES);
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

  if (status === 400 && /input token count|maximum number of tokens|INVALID_ARGUMENT/i.test(message)) {
    return new Error('Gemini 입력 한도를 초과했습니다. 클릭 요소 데이터를 자동 압축하거나 영역별로 나눈 뒤 다시 분석해야 합니다.');
  }

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
