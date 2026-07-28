import { GoogleGenAI } from '@google/genai';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  makeGa4ActionMetricKey,
  makeGa4MetricKey,
  queryGa4Metrics,
} from './ga4-data-api.mjs';
import {
  assertSktDataStartDate,
  getSktPageConfig,
  isExcludedSktGaAction,
} from './skt-page-config.mjs';
import { canonicalTrackingBase } from './skt-tracking-normalization.mjs';

const SNAPSHOTS_ROOT = path.resolve('snapshots');
const INPUT_SCHEMA_VERSION = 'compact-observations-v3-area';
const PROMPT_INSTRUCTIONS = Object.freeze([
  '너는 GA4, 이커머스/통신 상품 UX, 콘텐츠 전략, 측정 설계를 함께 보는 시니어 한국어 데이터 분석가다.',
  '분석 대상은 SKT의 T world Shop 한국 웹사이트이며 메인 또는 등록된 기획전 PC/MO 페이지 데이터다. 실제 대상 URL과 페이지 유형은 아래 JSON의 page를 우선해라.',
  '아래 JSON만 근거로 선택된 T world Shop 페이지 인사이트를 작성해라.',
  '데이터에 없는 사실, 판매 성과, 가입 전환, 구매 의도, 선호도, 원인 단정은 추측하지 마라.',
  '관찰된 사실, 가능한 해석, 제안사항을 명확히 구분해라. 분석 문장은 [관찰], 대안 해석은 [가설], 개선안은 [제안] 성격이 드러나게 작성해라.',
  '해석이나 제안에는 반드시 근거가 된 ga_action/ga_area/ga_label과 수치 또는 위치/기간 정보를 함께 적어라. ga_area가 없는 요소는 빈 값으로 취급한다. 근거가 부족하면 항목 수를 억지로 채우지 마라.',
  '분석을 하나의 결론에 몰아가지 말고 독립된 탐색 접점, UX/정보구조, 콘텐츠/프로모션, GA4 성과, 태깅/측정 품질, 운영/기간 변화 관점을 각각 검토해라.',
  '서로 다른 해석이 가능한 현상은 대안 해석과 이를 구분하기 위해 필요한 추가 데이터를 함께 제시해라.',
  'ga_action은 콘텐츠 영역 또는 컴포넌트 묶음, 선택 값인 ga_area는 그 안의 세부 영역, ga_label은 클릭 가능한 요소의 라벨로 해석하되 내부 태깅명일 수 있음을 감안해라.',
  '유지기간은 데이터 조회 기간 안에서 관찰된 기간이다. 유지기간 시작일을 실제 사이트 최초 노출일처럼 표현하지 마라.',
  'page.pageType과 실제 ga_action에 맞는 콘텐츠 영역을 비교해라. 메인 전용 영역이나 기획전 전용 영역이 데이터에 없으면 억지로 언급하지 마라.',
  'rolling 배너나 carousel 요소는 offscreen으로 캡처될 수 있다. offscreen/hidden/inViewport 값만 보고 실제 사용자 노출 여부나 스와이프 행동을 단정하지 말고 해석 주의사항으로 다뤄라.',
  '오늘 날짜가 포함된 조회는 GA4 데이터가 지연될 수 있다. 수치가 낮거나 불완전해 보이면 확정 데이터 여부를 주의사항으로 남겨라.',
  'eventCount는 클릭량이지 노출수나 클릭률이 아니다. 노출 데이터 없이 CTR, 주목도, 도달률을 계산하거나 단정하지 마라.',
  '클릭량만으로 효율, 성과 우수, 반응 잠재력, 수요, 니즈, 선호, 관심, 콘텐츠 매력도를 단정하지 마라. 필요하면 "클릭량이 많다/적다"로만 표현해라.',
  '요소별 sessions와 activeUsers는 같은 사용자가 여러 요소에 포함될 수 있으므로 요소나 그룹 간 단순 합계를 고유 세션/사용자 수처럼 표현하지 마라.',
  '요소 activeUsers를 전체 activeUsers로 나눈 값을 도달률이라고 부르지 마라. eventCount/sessions를 계산할 때는 클릭 세션당 평균 클릭 횟수라고만 표현하고 원인을 추론하지 마라.',
  '집계된 요소별 클릭 데이터에는 사용자별 선후 관계가 없다. 서로 다른 영역의 클릭을 하나의 사용자 여정으로 연결하거나 이탈, 퍼널 전환, 다음 행동, 탐색 실패로 단정하지 마라.',
  'journeyInsights에서도 각 클릭 요소를 독립된 탐색 접점으로만 비교해라. "진입했다", "이후", "이어졌다", "이탈했다", "전환했다"처럼 사용자 이동 순서를 뜻하는 문장을 쓰지 마라.',
  '화면의 y좌표는 캡처 HTML 안의 상대적 위치일 뿐 실제 사용자의 스크롤 도달을 뜻하지 않는다. 하단이라서 덜 노출되었다거나 도달률이 낮다고 단정하지 마라.',
  'hidden/offscreen/inViewport는 캡처 시점의 DOM 상태다. UI가 복잡하다, 사용자가 펼쳤다, 스와이프했다, 자동 롤링되었다, 인터랙션 유도가 부족하다고 단정하는 근거로 사용하지 마라.',
  'aboveFold도 캡처 HTML 좌표 기준이다. 사용자에게 실제 노출되었다고 표현하지 말고 "캡처 좌표상 aboveFold"라고만 표현해라.',
  '캐러셀의 DOM 순서나 좌표만으로 실제 노출 순서와 노출 시간을 알 수 없다. 배너 클릭 차이를 소재 효과 또는 순서 효과로 확정하지 마라.',
  '클릭량이 높은 요소는 위치, 노출 순서, 소재 자체의 영향이 섞여 있을 수 있다. 데이터만으로 원인을 분리할 수 없다면 가능한 설명을 병렬로 제시해라.',
  '개선사항은 현재 배치를 바로 바꾸라고 단정하지 말고 [우선순위], 대상, 관찰 근거, 개선 가설, 기대 신호, 검증 방법을 포함해라.',
  '제안사항에는 태깅 점검, 소재 비교, 영역별 클릭 비중 확인, 퍼널/전환 후속 분석, A/B 테스트처럼 실행하거나 검증할 수 있는 다음 단계를 포함해라.',
  'elements에는 모든 표 행이 들어 있고 observations.instances에는 같은 행으로 병합된 실제 클릭 요소별 관찰 정보가 압축되어 있다. 모든 클릭 요소와 위치/유지기간/GA4 수치를 빠짐없이 고려해라.',
  'observations의 위치 범위와 materialChanges는 날짜별 중복 좌표를 압축한 값이다. 값이 없다는 이유로 변화가 없었다고 단정하지 마라.',
  '조회 기간 전체의 집계 수치만 제공된 경우 특정 날짜의 성과 증감이나 요소 교체 전후 효과를 계산하지 마라.',
  '스냅샷이 하루뿐이면 신규, 소멸, 유지, 위치 변화라고 표현하지 말고 기간 변화는 평가할 수 없다고 명시해라.',
  '각 섹션에는 가능한 한 구체적인 수치를 포함하되 같은 내용을 여러 섹션에서 반복하지 마라.',
  '개선 제안은 최소 3개 관점에서 제시하고, 일반론 대신 현재 데이터의 구체적인 요소를 대상으로 작성해라.',
  'JSON 출력 전에 summary, journeyInsights, uxInsights, contentInsights, metricInsights, sectionInsights를 다시 점검해라. 이 관찰 섹션에 클릭스트림, 노출, 도달, 스크롤, 전환, 이탈, 선호, 관심, 수요, 원인에 대한 단정이 있으면 집계 클릭량에 대한 중립적 표현으로 고쳐라.',
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
  '각 관점의 결론과 개선 제안이 특정 조각에 치우치지 않았는지 확인하고, 상충하는 관찰은 대안 해석에 남겨라.',
]);
const PROMPT_OUTPUT_SCHEMA = Object.freeze({
  headline: '인과 추론 없이 클릭 데이터에서 직접 확인되는 한 문장 핵심 결론',
  summary: ['[관찰] 핵심 요약 3~5개'],
  journeyInsights: ['[관찰] 각 요소를 독립적으로 다루고 사용자 이동 순서를 연결하지 않는 탐색 접점별 클릭 분석 2~4개'],
  uxInsights: ['[관찰] 위치와 영역 맥락을 반영하되 실제 노출/스크롤을 추론하지 않는 UX 분석 2~4개'],
  contentInsights: ['[관찰] 상품, 요금제, 혜택, 프로모션 소재별 클릭량 비교 2~4개'],
  metricInsights: ['[관찰] GA4 수치 기반 분석 3~5개'],
  sectionInsights: ['[관찰] ga_action별 콘텐츠 영역 분석 3~5개'],
  measurementInsights: ['[관찰] 태깅 일관성, 중복, 누락 가능성, 추가 측정 필요사항 2~4개'],
  alternativeInterpretations: ['[가설] 가능한 해석 A/B | 현재 데이터로 구분 불가 | 추가 데이터: ... 형식 2~4개'],
  changes: ['유지기간/신규/소멸/변경 관련 관찰 0~4개. 스냅샷이 하루뿐이면 변화 평가 불가 1개만 작성'],
  watchouts: ['데이터 해석 주의사항 2~4개'],
  improvementIdeas: ['[제안][우선순위: 높음/중간/낮음] 대상 | 관찰 근거 | 개선 가설 | 기대 신호 | 검증 방법 형식의 개선안 3~6개'],
  experimentIdeas: ['[제안] 검증할 가설, 비교군, 핵심 판단 지표가 포함된 실험/분석안 2~4개'],
  actionItems: ['[제안] 담당자가 바로 확인하거나 실행할 수 있는 다음 단계 3~5개'],
});
const FOLLOW_UP_INSTRUCTIONS = Object.freeze([
  '너는 SKT T world Shop 페이지 대시보드의 후속 질문에 답하는 한국어 데이터 분석가다.',
  'analysis가 원본 근거이고 originalInsight는 앞서 생성한 요약이다. 두 값이 충돌하면 analysis를 우선해라.',
  '질문에 직접 답하고, 관련 ga_action/ga_area/ga_label, GA4 수치, 유지기간, 요소 위치를 가능한 한 구체적으로 제시해라.',
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
const DEFAULT_GEMINI_MODEL_PROFILE = 'flash';
const GEMINI_MODEL_PROFILES = Object.freeze({
  flash: Object.freeze({
    key: 'flash',
    id: process.env.GEMINI_FLASH_MODEL || 'gemini-3-flash-preview',
    label: 'Gemini 3 Flash',
    thinkingLevel: '',
  }),
  pro: Object.freeze({
    key: 'pro',
    id: process.env.GEMINI_PRO_MODEL || process.env.GEMINI_MODEL || 'gemini-3.1-pro-preview',
    label: 'Gemini 3.1 Pro',
    thinkingLevel: 'HIGH',
  }),
});
const GEMINI_APPLICATION_CREDENTIALS = process.env.GEMINI_APPLICATION_CREDENTIALS || process.env.GEMINI_GOOGLE_APPLICATION_CREDENTIALS || '';
const MAX_OUTPUT_TOKENS = positiveInteger(process.env.GEMINI_INSIGHTS_MAX_OUTPUT_TOKENS, 16_384);
const MAX_INPUT_TOKENS = positiveInteger(process.env.GEMINI_INSIGHTS_MAX_INPUT_TOKENS, 400_000);
const CHUNK_INPUT_TOKENS = Math.min(
  MAX_INPUT_TOKENS,
  positiveInteger(process.env.GEMINI_INSIGHTS_CHUNK_INPUT_TOKENS, 240_000),
);
const GEMINI_RETRY_ATTEMPTS = positiveInteger(process.env.GEMINI_INSIGHTS_RETRY_ATTEMPTS, 3);
const GEMINI_RETRY_DELAY_MS = positiveInteger(process.env.GEMINI_INSIGHTS_RETRY_DELAY_MS, 12_000);
const MAX_FOLLOW_UP_QUESTION_LENGTH = 1_000;
const MAX_FOLLOW_UP_HISTORY_MESSAGES = 8;
const MAX_FOLLOW_UP_HISTORY_CONTENT_LENGTH = 3_000;

export async function queryAiInsights({ targetId, startDate, endDate, model = DEFAULT_GEMINI_MODEL_PROFILE }) {
  validateDate(startDate, 'startDate');
  validateDate(endDate, 'endDate');
  if (!targetId) throw new Error('targetId is required.');
  if (startDate > endDate) throw new Error('startDate must be earlier than or equal to endDate.');
  assertSktDataStartDate(targetId, startDate);

  const modelProfile = resolveGeminiModelProfile(model);
  const cacheVersion = insightCacheVersion(modelProfile);
  const cachePath = getInsightCachePath({ targetId, startDate, endDate, modelProfile });
  const cached = await readJsonFile(cachePath);
  if (cached) return { ...cached, cached: true };

  const analysis = await buildInsightInput({ targetId, startDate, endDate });
  const generation = await generateGeminiInsight(analysis, modelProfile);
  const payload = {
    status: 'ok',
    cached: false,
    cacheVersion,
    promptVersion: PROMPT_VERSION,
    generatedAt: new Date().toISOString(),
    provider: 'vertex-ai',
    model: modelProfile.id,
    modelProfile: modelProfile.key,
    modelLabel: modelProfile.label,
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

export async function queryAiFollowUp({
  targetId,
  startDate,
  endDate,
  question,
  history = [],
  model = DEFAULT_GEMINI_MODEL_PROFILE,
}) {
  validateDate(startDate, 'startDate');
  validateDate(endDate, 'endDate');
  if (!targetId) throw new Error('targetId is required.');
  if (startDate > endDate) throw new Error('startDate must be earlier than or equal to endDate.');
  assertSktDataStartDate(targetId, startDate);

  const modelProfile = resolveGeminiModelProfile(model);
  const followUpCacheVersion = followUpCacheVersionFor(modelProfile);
  const normalizedQuestion = normalizeFollowUpQuestion(question);
  const normalizedHistory = normalizeFollowUpHistory(history);
  const followUpCachePath = getFollowUpCachePath({
    targetId,
    startDate,
    endDate,
    question: normalizedQuestion,
    history: normalizedHistory,
    modelProfile,
  });
  const cached = await readJsonFile(followUpCachePath);
  if (cached) return { ...cached, cached: true };

  const originalInsight = await queryAiInsights({ targetId, startDate, endDate, model: modelProfile.key });
  const insightCachePath = getInsightCachePath({ targetId, startDate, endDate, modelProfile });
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
  }, modelProfile);
  const payload = {
    status: 'ok',
    cached: false,
    cacheVersion: followUpCacheVersion,
    generatedAt: new Date().toISOString(),
    provider: 'vertex-ai',
    model: modelProfile.id,
    modelProfile: modelProfile.key,
    modelLabel: modelProfile.label,
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
  const pageConfig = getSktPageConfig(targetId);
  const trackingFields = pageConfig.usesGaArea ? 'ga_action/ga_area/ga_label' : 'ga_action/ga_label';

  return {
    dashboardLogic: {
      purpose:
        `T world Shop ${pageConfig.pageType === 'exhibition' ? '기획전' : '메인'} 페이지의 클릭 요소가 자주 바뀌고 각 요소의 ${trackingFields} 및 GA4 성과를 파악하기 어려운 문제를 줄이기 위한 대시보드입니다.`,
      snapshotRule:
        '봇이 매일 오전 10시 Asia/Seoul 기준으로 등록된 PC/MO 페이지 HTML과 클릭 어트리뷰트 요소를 저장합니다. 팝업은 검사 대상에서 제외합니다.',
      scopeRule:
        `수집 대상은 GNB/푸터를 제외한 콘텐츠 영역의 ${trackingFields} 요소입니다. ga_area는 기획전에서만 사용하며 값이 없을 수 있습니다.`,
      periodRule:
        `유지기간은 데이터 조회 기간 안에서 같은 ${trackingFields} 조합이 발견되어 유지된 날짜 구간이며 YYYY-MM-DD ~ YYYY-MM-DD 형식입니다. 예를 들어 2026-06-29 ~ 2026-06-29는 선택한 데이터 조회 기간 안에서 그 요소가 2026-06-29에만 관찰되었다는 뜻이지, 실제 서비스에서 그 요소가 2026-06-29에 처음 노출되었다는 뜻이 아닙니다.`,
      rowRule:
        `표의 행은 같은 ${trackingFields} 조합과 유지기간을 가진 요소를 병합할 수 있으며, observations.instances에는 병합된 실제 요소별 관찰 기간과 위치가 들어갑니다.`,
      previewRule:
        '기본 왼쪽 화면은 선택 기간 안의 최신 캡처본입니다. 최신 캡처본에 없는 요소를 선택하면 그 요소가 존재하던 기간의 최신 캡처본을 보여줍니다.',
      metricsRule:
        `GA4 eventCount/session/user는 선택 기간과 페이지 기준으로 조회합니다. eventName=click, event_category=${pageConfig.eventCategory}${ga4.hostname ? `, hostName=${ga4.hostname}` : ''}${pageConfig.usesGaArea ? ', 요소 행은 event_area를 ga_area와 매칭' : ''} 조건입니다. ga_action 대분류의 세 지표는 같은 총합 조건에 event_action만 dimension으로 추가한 별도 보고서 값이며 URL 조건이나 하위 요소 합계를 사용하지 않습니다.`,
      aiRule:
        'AI는 제공된 JSON에 있는 숫자와 위치 정보만 근거로 분석해야 하며, 날짜별 중복 관찰은 요소별 기간과 위치 범위 및 중요한 변경점으로 압축됩니다.',
      aiEvidenceLimit:
        '제공 데이터는 선택 기간의 요소별 집계 클릭 수, 세션 수, 사용자 수와 봇 캡처 좌표입니다. 사용자별 클릭 순서, 노출수, 배너별 노출 시간, 실제 스크롤 도달, 전환/매출 데이터는 제공되지 않으므로 사용자 여정 연결, CTR, 도달률, 이탈률, 전환율, 위치/소재의 인과 효과를 계산하거나 단정할 수 없습니다.',
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
      pageType: pageConfig.pageType,
      exhibitionId: pageConfig.exhibitionId || '',
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
      if (isExcludedSktGaAction(targetId, element.ga_action)) continue;
      const canonical = canonicalTrackingBase({
        targetId,
        date: run.date,
        action: element.ga_action,
        area: element.ga_area,
        label: element.ga_label,
        href: element.href,
      });
      const action = canonical.action;
      const area = canonical.area;
      const label = canonical.label;
      const ordinal = (identityCounts.get(canonical.identity) || 0) + 1;
      identityCounts.set(canonical.identity, ordinal);
      const key = `${canonical.identity}|${ordinal}`;
      const metricKey = makeGa4MetricKey(action, area, label);
      let record = recordsByKey.get(key);

      if (!record) {
        record = {
          key,
          metricKey,
          tracking: { action, area, label },
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

export function buildGroups(records, ga4 = {}) {
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
      const actionMetrics = ga4.actionMetrics?.[makeGa4ActionMetricKey(group.action)];
      if (actionMetrics) {
        rest.metrics.eventCount = Number(actionMetrics.eventCount || 0);
        rest.metrics.sessions = Number(actionMetrics.sessions || 0);
        rest.metrics.activeUsers = Number(actionMetrics.activeUsers || 0);
      }
      return rest;
    })
    .sort((left, right) => right.metrics.eventCount - left.metrics.eventCount);
}

async function generateGeminiInsight(analysis, modelProfile) {
  const ai = await createGeminiClient();
  const prompt = buildPrompt(analysis);
  const promptTokens = await countPromptTokens(ai, prompt, modelProfile);
  if (promptTokens <= MAX_INPUT_TOKENS) {
    return {
      insight: await generatePromptInsight(ai, prompt, modelProfile),
      mode: 'single',
      inputTokens: promptTokens,
      chunkCount: 1,
    };
  }

  return generateChunkedGeminiInsight(ai, analysis, modelProfile);
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

async function generateChunkedGeminiInsight(ai, analysis, modelProfile) {
  const chunks = await splitElementsToFit(ai, analysis, analysis.elements, CHUNK_INPUT_TOKENS, modelProfile);
  const chunkResults = [];
  let inputTokens = 0;

  for (const [index, elements] of chunks.entries()) {
    const chunkAnalysis = analysisForElements(analysis, elements, {
      index: index + 1,
      count: chunks.length,
    });
    const prompt = buildChunkPrompt(chunkAnalysis);
    const tokenCount = await countPromptTokens(ai, prompt, modelProfile);
    inputTokens += tokenCount;
    chunkResults.push({
      index: index + 1,
      elementCount: elements.length,
      actions: Array.from(new Set(elements.map((record) => record.tracking.action))),
      insight: await generatePromptInsight(ai, prompt, modelProfile),
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
  const synthesisTokens = await countPromptTokens(ai, synthesisPrompt, modelProfile);
  if (synthesisTokens > MAX_INPUT_TOKENS) {
    throw new Error('Gemini 분할 분석 결과도 입력 한도를 초과했습니다. 조회 기간을 나누어 분석해 주세요.');
  }

  inputTokens += synthesisTokens;
  return {
    insight: await generatePromptInsight(ai, synthesisPrompt, modelProfile),
    mode: 'chunked',
    inputTokens,
    chunkCount: chunks.length,
  };
}

async function generateGeminiFollowUp(ai, context, modelProfile) {
  const prompt = buildFollowUpPrompt(context);
  const promptTokens = await countPromptTokens(ai, prompt, modelProfile);
  if (promptTokens <= MAX_INPUT_TOKENS) {
    return {
      response: await generatePromptFollowUp(ai, prompt, modelProfile),
      mode: 'single',
      inputTokens: promptTokens,
      chunkCount: 1,
    };
  }

  const chunks = await splitFollowUpElementsToFit(
    ai,
    context,
    context.analysis.elements,
    CHUNK_INPUT_TOKENS,
    modelProfile,
  );
  const chunkResults = [];
  let inputTokens = 0;

  for (const [index, elements] of chunks.entries()) {
    const chunkContext = followUpContextForElements(context, elements, {
      index: index + 1,
      count: chunks.length,
    });
    const chunkPrompt = buildFollowUpChunkPrompt(chunkContext);
    const tokenCount = await countPromptTokens(ai, chunkPrompt, modelProfile);
    inputTokens += tokenCount;
    chunkResults.push({
      index: index + 1,
      actions: Array.from(new Set(elements.map((record) => record.tracking.action))),
      elementCount: elements.length,
      response: await generatePromptFollowUpChunk(ai, chunkPrompt, modelProfile),
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
  const synthesisTokens = await countPromptTokens(ai, synthesisPrompt, modelProfile);
  if (synthesisTokens > MAX_INPUT_TOKENS) {
    throw new Error('후속 질문의 분할 분석 결과가 입력 한도를 초과했습니다. 질문 범위를 조금 더 구체적으로 작성해 주세요.');
  }

  inputTokens += synthesisTokens;
  return {
    response: await generatePromptFollowUp(ai, synthesisPrompt, modelProfile),
    mode: 'chunked',
    inputTokens,
    chunkCount: chunks.length,
  };
}

async function splitFollowUpElementsToFit(
  ai,
  context,
  elements,
  tokenBudget = CHUNK_INPUT_TOKENS,
  modelProfile = GEMINI_MODEL_PROFILES[DEFAULT_GEMINI_MODEL_PROFILE],
) {
  const prompt = buildFollowUpChunkPrompt(followUpContextForElements(context, elements, { index: 1, count: 1 }));
  const tokenCount = await countPromptTokens(ai, prompt, modelProfile);
  if (tokenCount <= tokenBudget) return [elements];
  if (elements.length <= 1) {
    throw new Error('단일 클릭 요소의 후속 질문 입력이 허용 크기를 초과했습니다.');
  }

  const midpoint = Math.ceil(elements.length / 2);
  const left = await splitFollowUpElementsToFit(ai, context, elements.slice(0, midpoint), tokenBudget, modelProfile);
  const right = await splitFollowUpElementsToFit(ai, context, elements.slice(midpoint), tokenBudget, modelProfile);
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

export async function splitElementsToFit(
  ai,
  analysis,
  elements,
  tokenBudget = CHUNK_INPUT_TOKENS,
  modelProfile = GEMINI_MODEL_PROFILES[DEFAULT_GEMINI_MODEL_PROFILE],
) {
  const prompt = buildChunkPrompt(analysisForElements(analysis, elements, { index: 1, count: 1 }));
  const tokenCount = await countPromptTokens(ai, prompt, modelProfile);
  if (tokenCount <= tokenBudget) return [elements];
  if (elements.length <= 1) {
    throw new Error('단일 클릭 요소의 Gemini 입력이 허용 크기를 초과했습니다.');
  }

  const midpoint = Math.ceil(elements.length / 2);
  const left = await splitElementsToFit(ai, analysis, elements.slice(0, midpoint), tokenBudget, modelProfile);
  const right = await splitElementsToFit(ai, analysis, elements.slice(midpoint), tokenBudget, modelProfile);
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

async function generatePromptInsight(ai, prompt, modelProfile) {
  return generatePromptJson(ai, prompt, parseGeminiJson, modelProfile);
}

async function generatePromptFollowUp(ai, prompt, modelProfile) {
  return generatePromptJson(ai, prompt, parseFollowUpJson, modelProfile);
}

async function generatePromptFollowUpChunk(ai, prompt, modelProfile) {
  return generatePromptJson(ai, prompt, parseFollowUpChunkJson, modelProfile);
}

async function generatePromptJson(ai, prompt, parser, modelProfile) {
  const response = await generateGeminiContentWithRetry(ai, {
    model: modelProfile.id,
    contents: promptContents(prompt),
    config: {
      temperature: 0.2,
      maxOutputTokens: MAX_OUTPUT_TOKENS,
      responseMimeType: 'application/json',
      ...(modelProfile.thinkingLevel
        ? { thinkingConfig: { thinkingLevel: modelProfile.thinkingLevel } }
        : {}),
    },
  });
  return parser(response.text || '');
}

async function countPromptTokens(ai, prompt, modelProfile) {
  try {
    const response = await ai.models.countTokens({
      model: modelProfile.id,
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
      journeyInsights: [],
      uxInsights: [],
      contentInsights: [],
      metricInsights: [],
      sectionInsights: [],
      measurementInsights: [],
      alternativeInterpretations: [],
      changes: [],
      watchouts: ['응답 형식 오류가 있어 원문 일부만 표시합니다.'],
      improvementIdeas: [],
      experimentIdeas: [],
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

function getInsightCachePath({ targetId, startDate, endDate, modelProfile }) {
  const key = `${insightCacheVersion(modelProfile)}:${targetId}:${startDate}:${endDate}`;
  const digest = crypto.createHash('sha1').update(key).digest('hex').slice(0, 16);
  return path.join(INSIGHTS_CACHE_DIR, `${targetId}-${startDate}-${endDate}-${digest}.json`);
}

function getInsightAnalysisPath(cachePath) {
  return cachePath.replace(/\.json$/, '.analysis.json');
}

function getFollowUpCachePath({ targetId, startDate, endDate, question, history, modelProfile }) {
  const key = JSON.stringify({
    version: followUpCacheVersionFor(modelProfile),
    targetId,
    startDate,
    endDate,
    question,
    history,
  });
  const digest = crypto.createHash('sha1').update(key).digest('hex').slice(0, 20);
  return path.join(FOLLOW_UP_CACHE_DIR, `${targetId}-${startDate}-${endDate}-${digest}.json`);
}

function insightCacheVersion(modelProfile) {
  return `v3:${modelProfile.id}:${INPUT_SCHEMA_VERSION}:${PROMPT_VERSION}`;
}

function followUpCacheVersionFor(modelProfile) {
  return `v2:${modelProfile.id}:${INPUT_SCHEMA_VERSION}:${FOLLOW_UP_VERSION}`;
}

export function normalizeGeminiModelProfile(value) {
  return resolveGeminiModelProfile(value).key;
}

function resolveGeminiModelProfile(value) {
  const requested = String(value || DEFAULT_GEMINI_MODEL_PROFILE).trim().toLowerCase();
  const profile =
    GEMINI_MODEL_PROFILES[requested] ||
    Object.values(GEMINI_MODEL_PROFILES).find((candidate) => candidate.id.toLowerCase() === requested);
  if (!profile) {
    throw new Error('model must be flash or pro.');
  }
  return profile;
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
