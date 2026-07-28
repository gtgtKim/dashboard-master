import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildGa4DimensionFilter,
  buildUnsampledReportDefinition,
  GA4_CONFIG,
  ga4CategoryForTargetId,
  ga4HostnameForTargetId,
  makeGa4ActionMetricKey,
  makeGa4MetricKey,
} from '../scripts/ga4-data-api.mjs';
import {
  assertSktDataStartDate,
  dataAvailableFromForTargetId,
  isExcludedSktGaAction,
  isIncludedSktFixedAction,
  usesGaAreaForTargetId,
} from '../scripts/skt-page-config.mjs';
import { canonicalTrackingBase } from '../scripts/skt-tracking-normalization.mjs';

test('uses the exhibition GA4 categories and mobile hostname filter', () => {
  assert.equal(ga4CategoryForTargetId('pc-exhibition-p00000494'), 'TWD_exhibition - P00000494');
  assert.equal(ga4CategoryForTargetId('mobile-exhibition-p00000494'), 'MTWD_exhibition - P00000494');
  assert.equal(ga4CategoryForTargetId('mobile-exhibition-p00000495'), 'MTWD - P00000495');
  assert.equal(ga4HostnameForTargetId('pc-exhibition-p00000494'), null);
  assert.equal(ga4HostnameForTargetId('mobile-exhibition-p00000494'), 'm.shop.tworld.co.kr');
  assert.equal(ga4HostnameForTargetId('mobile-exhibition-p00000495'), 'my-shop.tworld.co.kr');
});

test('limits exhibition data queries to 2026-07-28 and later', () => {
  assert.equal(dataAvailableFromForTargetId('pc-exhibition-p00000494'), '2026-07-28');
  assert.equal(dataAvailableFromForTargetId('mobile-exhibition-p00000494'), '2026-07-28');
  assert.equal(dataAvailableFromForTargetId('mobile-exhibition-p00000495'), '2026-07-28');
  assert.equal(dataAvailableFromForTargetId('pc-main'), '');
  assert.doesNotThrow(() => assertSktDataStartDate('pc-exhibition-p00000494', '2026-07-28'));
  assert.throws(
    () => assertSktDataStartDate('mobile-exhibition-p00000494', '2026-07-27'),
    /must be on or after 2026-07-28/,
  );
  assert.throws(
    () => assertSktDataStartDate('mobile-exhibition-p00000495', '2026-07-27'),
    /must be on or after 2026-07-28/,
  );
  assert.doesNotThrow(() =>
    assertSktDataStartDate('mobile-exhibition-p00000495', '2026-07-28'),
  );
  assert.doesNotThrow(() => assertSktDataStartDate('mobile-main', '2026-06-25'));
});

test('enables ga_area and legacy action exclusions only for exhibition pages', () => {
  assert.equal(usesGaAreaForTargetId('pc-exhibition-p00000494'), true);
  assert.equal(usesGaAreaForTargetId('mobile-exhibition-p00000494'), true);
  assert.equal(usesGaAreaForTargetId('mobile-exhibition-p00000495'), true);
  assert.equal(usesGaAreaForTargetId('pc-main'), false);
  assert.equal(isExcludedSktGaAction('pc-exhibition-p00000494', 'SNS 공유하기'), true);
  assert.equal(isExcludedSktGaAction('mobile-exhibition-p00000494', '기획전 하단'), true);
  assert.equal(isExcludedSktGaAction('mobile-exhibition-p00000495', '기획전 하단'), true);
  assert.equal(isExcludedSktGaAction('pc-main', '기획전 하단'), false);
  assert.equal(isIncludedSktFixedAction('pc-exhibition-p00000494', '고정 하단 배너'), true);
  assert.equal(isIncludedSktFixedAction('mobile-exhibition-p00000494', '고정 하단 배너'), true);
  assert.equal(isIncludedSktFixedAction('pc-exhibition-p00000494', '고정 퀵 메뉴'), true);
  assert.equal(isIncludedSktFixedAction('mobile-exhibition-p00000494', '고정 퀵 메뉴'), true);
  assert.equal(isIncludedSktFixedAction('mobile-exhibition-p00000495', '고정 퀵 메뉴'), true);
  assert.equal(isIncludedSktFixedAction('pc-main', '고정 하단 배너'), false);
  assert.equal(isIncludedSktFixedAction('pc-main', '고정 퀵 메뉴'), false);
});

test('includes optional ga_area in metric keys without changing main page keys', () => {
  assert.equal(
    makeGa4MetricKey('Galaxy', 'Galaxy Z Fold8', '자세히 보기'),
    'Galaxy::Galaxy%20Z%20Fold8::%EC%9E%90%EC%84%B8%ED%9E%88%20%EB%B3%B4%EA%B8%B0',
  );
  assert.equal(makeGa4MetricKey('메인 배너', '', '배너 1'), makeGa4MetricKey('메인 배너', '배너 1'));
});

test('treats ga_area as part of an element identity', () => {
  const first = canonicalTrackingBase({
    targetId: 'pc-exhibition-p00000494',
    date: '2026-07-27',
    action: 'Galaxy',
    area: 'Fold',
    label: '자세히 보기',
  });
  const second = canonicalTrackingBase({
    targetId: 'pc-exhibition-p00000494',
    date: '2026-07-27',
    action: 'Galaxy',
    area: 'Flip',
    label: '자세히 보기',
  });

  assert.notEqual(first.identity, second.identity);
});

test('builds UNSAMPLED report tasks with totals', () => {
  const definition = buildUnsampledReportDefinition({
    startDate: '2026-06-25',
    endDate: '2026-07-27',
    dimensions: [{ name: GA4_CONFIG.dimensions.eventAction }],
    metrics: [{ name: 'eventCount' }],
    dimensionFilter: buildGa4DimensionFilter({ eventCategory: 'TWD_main' }),
  });

  assert.equal(definition.samplingLevel, 'UNSAMPLED');
  assert.deepEqual(definition.metricAggregations, ['TOTAL']);
  assert.equal(definition.limit, 250000);
});

test('builds exact action filters for alias aggregation reports', () => {
  const filter = buildGa4DimensionFilter({
    eventCategory: 'TWD_main',
    actionAliases: ['메인 배너', '메인배너'],
  });
  const actionFilter = filter.andGroup.expressions.at(-1).filter;

  assert.equal(actionFilter.fieldName, GA4_CONFIG.dimensions.eventAction);
  assert.deepEqual(actionFilter.inListFilter.values, ['메인 배너', '메인배너']);
  assert.equal(actionFilter.inListFilter.caseSensitive, true);
});

test('uses total filters for action grouping without a URL condition', () => {
  const filter = buildGa4DimensionFilter({
    eventCategory: 'MTWD_main',
    hostname: 'm.shop.tworld.co.kr',
  });
  const fieldNames = filter.andGroup.expressions.map(
    (expression) => expression.filter.fieldName,
  );

  assert.deepEqual(fieldNames, [
    'eventName',
    GA4_CONFIG.dimensions.eventCategory,
    GA4_CONFIG.dimensions.hostname,
  ]);
  assert.equal(fieldNames.includes('pageLocation'), false);
});

test('uses stable encoded keys for action-level metrics', () => {
  assert.equal(makeGa4ActionMetricKey('메인 배너'), '%EB%A9%94%EC%9D%B8%20%EB%B0%B0%EB%84%88');
  assert.equal(makeGa4ActionMetricKey(''), '(missing)');
});
