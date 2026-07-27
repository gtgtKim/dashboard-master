import { getSktPageConfig } from './skt-page-config.mjs';

export const SKT_MAIN_TRACKING_TRIM_START_DATE = '2026-06-25';

export const SKT_TRACKING_CORRECTIONS = Object.freeze([
  Object.freeze({
    id: 'mobile-main-banner-2026-07',
    targetId: 'mobile-main',
    startDate: '2026-07-08',
    endDate: '2026-07-20',
    rawAction: '모바일 메인 배너',
    canonicalAction: '메인 배너',
  }),
  Object.freeze({
    id: 'pc-main-banner-action-alias',
    targetId: 'pc-main',
    startDate: '0000-01-01',
    endDate: '9999-12-31',
    rawAction: '메인배너',
    canonicalAction: '메인 배너',
  }),
]);

export function normalizeSktGaAction({ targetId, date, action }) {
  const rawAction = action || '(missing)';
  const normalizedAction = normalizeSktMainGaActionValue({ targetId, date, action: rawAction });
  const correction = SKT_TRACKING_CORRECTIONS.find(
    (rule) =>
      rule.targetId === targetId &&
      rule.rawAction === normalizedAction &&
      date >= rule.startDate &&
      date <= rule.endDate,
  );

  return correction?.canonicalAction || normalizedAction;
}

export function normalizeSktGaActionForRange({ targetId, startDate, endDate, action }) {
  const rawAction = action || '(missing)';
  const normalizedAction = normalizeSktMainGaActionValue({
    targetId,
    date: endDate || startDate,
    action: rawAction,
  });
  const correction = SKT_TRACKING_CORRECTIONS.find(
    (rule) =>
      rule.targetId === targetId &&
      rule.rawAction === normalizedAction &&
      startDate <= rule.endDate &&
      endDate >= rule.startDate,
  );

  return correction?.canonicalAction || normalizedAction;
}

export function normalizeSktGaLabel({ targetId, date, label = '' }) {
  const rawLabel = String(label ?? '');
  const pageType = getSktPageConfig(targetId).pageType;
  const shouldTrim =
    pageType === 'exhibition' ||
    (pageType === 'main' && String(date || '') >= SKT_MAIN_TRACKING_TRIM_START_DATE);

  return shouldTrim ? rawLabel.trim() : rawLabel;
}

export function normalizeSktGaLabelForRange({ targetId, startDate, endDate, label = '' }) {
  const rawLabel = String(label ?? '');
  const pageType = getSktPageConfig(targetId).pageType;
  const shouldTrim =
    pageType === 'exhibition' ||
    (pageType === 'main' && String(endDate || startDate || '') >= SKT_MAIN_TRACKING_TRIM_START_DATE);

  return shouldTrim ? rawLabel.trim() : rawLabel;
}

export function normalizeSktTracking({ targetId, date, action, area = '', label = '' }) {
  const rawAction = action || '(missing)';
  const canonicalAction = normalizeSktGaAction({ targetId, date, action: rawAction });
  const rawLabel = String(label ?? '');
  const canonicalLabel = normalizeSktGaLabel({ targetId, date, label: rawLabel });

  return {
    action: canonicalAction,
    area: area || '',
    label: canonicalLabel,
    rawAction,
    rawLabel,
    corrected: canonicalAction !== rawAction || canonicalLabel !== rawLabel,
  };
}

export function canonicalTrackingBase({ targetId, date, action, area = '', label = '', href = '' }) {
  const tracking = normalizeSktTracking({ targetId, date, action, area, label });
  return {
    ...tracking,
    identity: [targetId, tracking.action, tracking.area, tracking.label, href || ''].join('|'),
  };
}

function normalizeSktMainGaActionValue({ targetId, date, action }) {
  const rawAction = String(action || '(missing)');
  const isMainPage = getSktPageConfig(targetId).pageType === 'main';
  if (!isMainPage || String(date || '') < SKT_MAIN_TRACKING_TRIM_START_DATE) return rawAction;
  return rawAction.trim() || '(missing)';
}
