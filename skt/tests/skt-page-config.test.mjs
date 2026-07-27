import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildGa4DimensionFilter,
  buildUnsampledReportDefinition,
  GA4_CONFIG,
  ga4CategoryForTargetId,
  ga4HostnameForTargetId,
  makeGa4MetricKey,
  PC_MAIN_BANNER_ACTION_ALIASES,
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
  assert.equal(ga4HostnameForTargetId('pc-exhibition-p00000494'), null);
  assert.equal(ga4HostnameForTargetId('mobile-exhibition-p00000494'), 'm.shop.tworld.co.kr');
});

test('limits exhibition data queries to 2026-07-27 and later', () => {
  assert.equal(dataAvailableFromForTargetId('pc-exhibition-p00000494'), '2026-07-27');
  assert.equal(dataAvailableFromForTargetId('mobile-exhibition-p00000494'), '2026-07-27');
  assert.equal(dataAvailableFromForTargetId('pc-main'), '');
  assert.doesNotThrow(() => assertSktDataStartDate('pc-exhibition-p00000494', '2026-07-27'));
  assert.throws(
    () => assertSktDataStartDate('mobile-exhibition-p00000494', '2026-07-26'),
    /must be on or after 2026-07-27/,
  );
  assert.doesNotThrow(() => assertSktDataStartDate('mobile-main', '2026-06-25'));
});

test('enables ga_area and legacy action exclusions only for exhibition pages', () => {
  assert.equal(usesGaAreaForTargetId('pc-exhibition-p00000494'), true);
  assert.equal(usesGaAreaForTargetId('mobile-exhibition-p00000494'), true);
  assert.equal(usesGaAreaForTargetId('pc-main'), false);
  assert.equal(isExcludedSktGaAction('pc-exhibition-p00000494', 'SNS 공유하기'), true);
  assert.equal(isExcludedSktGaAction('mobile-exhibition-p00000494', '기획전 하단'), true);
  assert.equal(isExcludedSktGaAction('pc-main', '기획전 하단'), false);
  assert.equal(isIncludedSktFixedAction('pc-exhibition-p00000494', '고정 하단 배너'), true);
  assert.equal(isIncludedSktFixedAction('mobile-exhibition-p00000494', '고정 하단 배너'), true);
  assert.equal(isIncludedSktFixedAction('pc-exhibition-p00000494', '고정 퀵 메뉴'), true);
  assert.equal(isIncludedSktFixedAction('mobile-exhibition-p00000494', '고정 퀵 메뉴'), true);
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

test('filters the PC main banner alias report by both action spellings', () => {
  const filter = buildGa4DimensionFilter({
    eventCategory: 'TWD_main',
    actionAliases: PC_MAIN_BANNER_ACTION_ALIASES,
  });
  const actionFilter = filter.andGroup.expressions.at(-1).filter;

  assert.equal(actionFilter.fieldName, GA4_CONFIG.dimensions.eventAction);
  assert.deepEqual(actionFilter.inListFilter.values, ['메인 배너', '메인배너']);
  assert.equal(actionFilter.inListFilter.caseSensitive, true);
});
