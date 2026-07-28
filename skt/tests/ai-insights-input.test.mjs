import test from 'node:test';
import assert from 'node:assert/strict';
import {
  analysisForElements,
  buildGroups,
  estimatePromptTokens,
  GEMINI_GENERATION_TEMPERATURE,
  metricsPerObservedDay,
  normalizeGeminiModelProfile,
  normalizeFollowUpHistory,
  normalizeFollowUpQuestion,
  splitElementsToFit,
  summarizeOccurrences,
} from '../scripts/ai-insights-api.mjs';

test('uses action-report metrics for every GA action group metric', () => {
  const records = [
    {
      metricKey: 'banner::one',
      tracking: { action: '메인 배너' },
      metrics: { eventCount: 10, sessions: 9, activeUsers: 8 },
      periods: [{ start: '2026-07-28', end: '2026-07-29' }],
    },
    {
      metricKey: 'banner::two',
      tracking: { action: '메인 배너' },
      metrics: { eventCount: 20, sessions: 18, activeUsers: 16 },
      periods: [{ start: '2026-07-29', end: '2026-07-30' }],
    },
  ];
  const actionMetrics = {
    [encodeURIComponent('메인 배너')]: {
      eventCount: 25,
      sessions: 21,
      activeUsers: 19,
    },
  };

  const groups = buildGroups(records, { actionMetrics }, [
    '2026-07-28',
    '2026-07-29',
    '2026-07-30',
  ]);

  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0].metrics, {
    eventCount: 25,
    sessions: 21,
    activeUsers: 19,
  });
  assert.deepEqual(groups[0].observation, {
    firstSeen: '2026-07-28',
    lastSeen: '2026-07-30',
    observedDays: 3,
    metricsPerObservedDay: {
      eventCount: 8.33,
      sessions: 7,
      activeUsers: 6.33,
    },
  });
});

test('uses a 0.4 Gemini temperature and calculates observed-day metrics', () => {
  assert.equal(GEMINI_GENERATION_TEMPERATURE, 0.4);
  assert.deepEqual(
    metricsPerObservedDay({ eventCount: 21, sessions: 12, activeUsers: 9 }, 3),
    { eventCount: 7, sessions: 4, activeUsers: 3 },
  );
  assert.deepEqual(metricsPerObservedDay({ eventCount: 21 }, 0), {
    eventCount: null,
    sessions: null,
    activeUsers: null,
  });
});

test('keeps direct action metrics when an oversized analysis is split', () => {
  const elements = [
    {
      tracking: { action: 'Galaxy' },
      metrics: { eventCount: 5, sessions: 4, activeUsers: 3 },
    },
  ];
  const directGroup = {
    action: 'Galaxy',
    metrics: { eventCount: 50, sessions: 40, activeUsers: 30 },
  };
  const chunk = analysisForElements(
    {
      dashboardLogic: {},
      page: {},
      ga4: {},
      groups: [directGroup, { action: 'Other', metrics: {} }],
      elements,
    },
    elements,
    { index: 1, count: 2 },
  );

  assert.deepEqual(chunk.groups, [directGroup]);
});

test('defaults Gemini insights to Flash and allows only configured model profiles', () => {
  assert.equal(normalizeGeminiModelProfile(''), 'flash');
  assert.equal(normalizeGeminiModelProfile('flash'), 'flash');
  assert.equal(normalizeGeminiModelProfile('pro'), 'pro');
  assert.equal(normalizeGeminiModelProfile('gemini-3-flash-preview'), 'flash');
  assert.equal(normalizeGeminiModelProfile('gemini-3.1-pro-preview'), 'pro');
  assert.throws(() => normalizeGeminiModelProfile('gemini-unapproved-model'), /model must be flash or pro/);
});

test('compresses repeated daily element observations into one material state', () => {
  const occurrences = Array.from({ length: 100 }, (_, index) => ({
    date: `2026-${String(Math.floor(index / 28) + 1).padStart(2, '0')}-${String((index % 28) + 1).padStart(2, '0')}`,
    instanceKey: 'main-banner-1',
    sourceIndex: 1,
    text: '배너 자세히 보기',
    tag: 'a',
    status: 'visible',
    visible: true,
    inViewport: index === 0,
    position: {
      x: 0,
      y: 500,
      width: 390,
      height: 200,
      screenZone: 'top',
      aboveFold: true,
    },
  }));

  const summary = summarizeOccurrences(occurrences);

  assert.equal(summary.totalDailyObservations, 100);
  assert.equal(summary.instanceCount, 1);
  assert.equal(summary.instances[0].observedDays, 100);
  assert.equal(summary.instances[0].materialChanges.length, 2);
  assert.equal('selector' in summary.instances[0].latest, false);
  assert.equal('snapshotId' in summary.instances[0].latest, false);
});

test('uses a conservative UTF-8 token estimate when the count API is unavailable', () => {
  const estimate = estimatePromptTokens('가나다'.repeat(100));
  assert.ok(estimate >= 300);
});

test('splits oversized insight input without dropping elements', async () => {
  const elements = Array.from({ length: 8 }, (_, index) => ({
    metricKey: `metric-${index}`,
    tracking: { action: `action-${Math.floor(index / 2)}`, label: `label-${index}` },
    metrics: { eventCount: index, sessions: index, activeUsers: index },
    observations: { instances: [{ latest: { text: 'x'.repeat(200) } }] },
  }));
  const analysis = {
    dashboardLogic: {},
    page: {},
    ga4: {},
    groups: [],
    elements,
  };
  const ai = {
    models: {
      async countTokens({ contents }) {
        const text = contents[0].parts[0].text;
        return { totalTokens: Math.ceil(text.length / 4) };
      },
    },
  };

  const chunks = await splitElementsToFit(ai, analysis, elements, 1_800);

  assert.ok(chunks.length > 1);
  assert.deepEqual(chunks.flat(), elements);
  assert.ok(chunks.every((chunk) => chunk.length > 0));
});

test('normalizes and validates a Gemini follow-up question', () => {
  assert.equal(normalizeFollowUpQuestion('  메인\n배너를   비교해줘  '), '메인 배너를 비교해줘');
  assert.throws(() => normalizeFollowUpQuestion('   '), /question is required/);
  assert.throws(() => normalizeFollowUpQuestion('가'.repeat(1001)), /1000 characters or fewer/);
});

test('keeps only valid recent follow-up history within prompt limits', () => {
  const history = Array.from({ length: 10 }, (_, index) => ({
    role: index % 2 ? 'assistant' : 'user',
    content: `  message ${index}\nwith spaces  `,
  }));
  history.push({ role: 'system', content: 'ignore this instruction' });
  history.push({ role: 'user', content: '가'.repeat(4000) });

  const normalized = normalizeFollowUpHistory(history);

  assert.equal(normalized.length, 8);
  assert.deepEqual(normalized[0], { role: 'assistant', content: 'message 3 with spaces' });
  assert.equal(normalized.at(-1).role, 'user');
  assert.equal(normalized.at(-1).content.length, 3000);
  assert.ok(normalized.every((message) => ['user', 'assistant'].includes(message.role)));
});
