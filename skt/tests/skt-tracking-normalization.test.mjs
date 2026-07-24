import test from 'node:test';
import assert from 'node:assert/strict';
import {
  canonicalTrackingBase,
  normalizeSktGaAction,
  normalizeSktGaActionForRange,
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
