import test from 'node:test';
import assert from 'node:assert/strict';
import {
  canonicalTrackingBase,
  normalizeSktGaAction,
  normalizeSktGaActionForRange,
  normalizeSktGaLabel,
  normalizeSktGaLabelForRange,
} from '../scripts/skt-tracking-normalization.mjs';

test('normalizes the mobile main banner typo only inside the correction period', () => {
  assert.equal(
    normalizeSktGaAction({
      targetId: 'mobile-main',
      date: '2026-07-08',
      action: '모바일 메인 배너',
    }),
    '메인 배너',
  );
  assert.equal(
    normalizeSktGaAction({
      targetId: 'mobile-main',
      date: '2026-07-20',
      action: '모바일 메인 배너',
    }),
    '메인 배너',
  );
  assert.equal(
    normalizeSktGaAction({
      targetId: 'mobile-main',
      date: '2026-07-07',
      action: '모바일 메인 배너',
    }),
    '모바일 메인 배너',
  );
  assert.equal(
    normalizeSktGaAction({
      targetId: 'mobile-main',
      date: '2026-07-21',
      action: '모바일 메인 배너',
    }),
    '모바일 메인 배너',
  );
});

test('does not apply the mobile correction to the PC page', () => {
  assert.equal(
    normalizeSktGaAction({
      targetId: 'pc-main',
      date: '2026-07-10',
      action: '모바일 메인 배너',
    }),
    '모바일 메인 배너',
  );
});

test('uses the canonical action in element identity', () => {
  const corrected = canonicalTrackingBase({
    targetId: 'mobile-main',
    date: '2026-07-10',
    action: '모바일 메인 배너',
    label: 'banner-a',
    href: '/event',
  });
  const canonical = canonicalTrackingBase({
    targetId: 'mobile-main',
    date: '2026-07-21',
    action: '메인 배너',
    label: 'banner-a',
    href: '/event',
  });

  assert.equal(corrected.identity, canonical.identity);
  assert.equal(corrected.corrected, true);
});

test('keeps one canonical identity before, during, and after the typo period', () => {
  const observations = [
    ['2026-07-07', '메인 배너'],
    ['2026-07-08', '모바일 메인 배너'],
    ['2026-07-20', '모바일 메인 배너'],
    ['2026-07-21', '메인 배너'],
  ].map(([date, action]) =>
    canonicalTrackingBase({
      targetId: 'mobile-main',
      date,
      action,
      label: 'banner-a',
      href: '/event',
    }),
  );

  assert.equal(new Set(observations.map((item) => item.identity)).size, 1);
});

test('normalizes GA4 rows when the requested range intersects the correction period', () => {
  assert.equal(
    normalizeSktGaActionForRange({
      targetId: 'mobile-main',
      startDate: '2026-07-01',
      endDate: '2026-07-31',
      action: '모바일 메인 배너',
    }),
    '메인 배너',
  );
  assert.equal(
    normalizeSktGaActionForRange({
      targetId: 'mobile-main',
      startDate: '2026-07-21',
      endDate: '2026-07-31',
      action: '모바일 메인 배너',
    }),
    '모바일 메인 배너',
  );
});

test('merges the PC main banner action alias for snapshots and GA4 ranges', () => {
  assert.equal(
    normalizeSktGaAction({
      targetId: 'pc-main',
      date: '2026-06-25',
      action: '메인배너',
    }),
    '메인 배너',
  );
  assert.equal(
    normalizeSktGaActionForRange({
      targetId: 'pc-main',
      startDate: '2026-06-25',
      endDate: '2026-07-27',
      action: '메인배너',
    }),
    '메인 배너',
  );
  assert.equal(
    normalizeSktGaAction({
      targetId: 'mobile-main',
      date: '2026-07-27',
      action: '메인배너',
    }),
    '메인배너',
  );
});

test('trims main labels from 2026-06-25 and keeps earlier labels unchanged', () => {
  assert.equal(
    normalizeSktGaLabel({
      targetId: 'pc-main',
      date: '2026-06-25',
      label: '  메인 라벨  ',
    }),
    '메인 라벨',
  );
  assert.equal(
    normalizeSktGaLabel({
      targetId: 'mobile-main',
      date: '2026-06-24',
      label: '  메인 라벨  ',
    }),
    '  메인 라벨  ',
  );
  assert.equal(
    normalizeSktGaLabelForRange({
      targetId: 'mobile-main',
      startDate: '2026-06-25',
      endDate: '2026-07-27',
      label: '  메인 라벨  ',
    }),
    '메인 라벨',
  );
});

test('always trims exhibition labels without changing internal whitespace', () => {
  assert.equal(
    normalizeSktGaLabel({
      targetId: 'pc-exhibition-p00000494',
      date: '2026-07-27',
      label: '  Galaxy  Z Fold8  ',
    }),
    'Galaxy  Z Fold8',
  );
  assert.equal(
    normalizeSktGaLabelForRange({
      targetId: 'mobile-exhibition-p00000494',
      startDate: '2026-07-27',
      endDate: '2026-07-27',
      label: '\n자세히 보기\t',
    }),
    '자세히 보기',
  );
});

test('uses trimmed labels in canonical element identity', () => {
  const spaced = canonicalTrackingBase({
    targetId: 'pc-main',
    date: '2026-06-25',
    action: '메인배너',
    label: ' 배너 라벨 ',
    href: '/event',
  });
  const normalized = canonicalTrackingBase({
    targetId: 'pc-main',
    date: '2026-07-27',
    action: '메인 배너',
    label: '배너 라벨',
    href: '/event',
  });

  assert.equal(spaced.identity, normalized.identity);
  assert.equal(spaced.action, '메인 배너');
  assert.equal(spaced.label, '배너 라벨');
});

test('trims main actions from 2026-06-25 before applying aliases', () => {
  assert.equal(
    normalizeSktGaAction({
      targetId: 'mobile-main',
      date: '2026-07-27',
      action: ' Galaxy Z Fold8 Ultra | Fold8 | Flip8 ',
    }),
    'Galaxy Z Fold8 Ultra | Fold8 | Flip8',
  );
  assert.equal(
    normalizeSktGaAction({
      targetId: 'pc-main',
      date: '2026-07-27',
      action: ' 메인배너 ',
    }),
    '메인 배너',
  );
  assert.equal(
    normalizeSktGaActionForRange({
      targetId: 'pc-main',
      startDate: '2026-06-25',
      endDate: '2026-07-27',
      action: ' 메인배너 ',
    }),
    '메인 배너',
  );
});

test('keeps main actions before 2026-06-25 and exhibition actions unchanged', () => {
  assert.equal(
    normalizeSktGaAction({
      targetId: 'mobile-main',
      date: '2026-06-24',
      action: ' 메인 action ',
    }),
    ' 메인 action ',
  );
  assert.equal(
    normalizeSktGaAction({
      targetId: 'pc-exhibition-p00000494',
      date: '2026-07-27',
      action: ' 기획전 action ',
    }),
    ' 기획전 action ',
  );
});
