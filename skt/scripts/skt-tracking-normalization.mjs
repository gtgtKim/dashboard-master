export const SKT_TRACKING_CORRECTIONS = Object.freeze([
  Object.freeze({
    id: 'mobile-main-banner-2026-07',
    targetId: 'mobile-main',
    startDate: '2026-07-08',
    endDate: '2026-07-20',
    rawAction: '모바일 메인 배너',
    canonicalAction: '메인 배너',
  }),
]);

export function normalizeSktGaAction({ targetId, date, action }) {
  const rawAction = action || '(missing)';
  const correction = SKT_TRACKING_CORRECTIONS.find(
    (rule) =>
      rule.targetId === targetId &&
      rule.rawAction === rawAction &&
      date >= rule.startDate &&
      date <= rule.endDate,
  );

  return correction?.canonicalAction || rawAction;
}

export function normalizeSktGaActionForRange({ targetId, startDate, endDate, action }) {
  const rawAction = action || '(missing)';
  const correction = SKT_TRACKING_CORRECTIONS.find(
    (rule) =>
      rule.targetId === targetId &&
      rule.rawAction === rawAction &&
      startDate <= rule.endDate &&
      endDate >= rule.startDate,
  );

  return correction?.canonicalAction || rawAction;
}

export function normalizeSktTracking({ targetId, date, action, label = '' }) {
  const rawAction = action || '(missing)';
  const canonicalAction = normalizeSktGaAction({ targetId, date, action: rawAction });

  return {
    action: canonicalAction,
    label: label || '',
    rawAction,
    corrected: canonicalAction !== rawAction,
  };
}

export function canonicalTrackingBase({ targetId, date, action, label = '', href = '' }) {
  const tracking = normalizeSktTracking({ targetId, date, action, label });
  return {
    ...tracking,
    identity: [targetId, tracking.action, tracking.label, href || ''].join('|'),
  };
}
