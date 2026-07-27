export const SKT_EXHIBITION_LEGACY_ACTIONS = Object.freeze([
  'SNS 공유하기',
  'SNS 공유하기 팝업',
  '기획전 상세',
  '기획전 하단',
]);

export const SKT_EXHIBITION_FIXED_ACTIONS = Object.freeze([
  '고정 하단 배너',
  '고정 퀵 메뉴',
]);

export const SKT_PAGE_CONFIGS = Object.freeze([
  Object.freeze({
    id: 'mobile-main',
    label: 'T world Shop Mobile Main',
    url: 'https://m.shop.tworld.co.kr/shop/main',
    device: 'mobile',
    pageType: 'main',
    eventCategory: 'MTWD_main',
    usesGaArea: false,
    requireMobileHostname: true,
    excludedActions: Object.freeze([]),
    includedFixedActions: Object.freeze([]),
  }),
  Object.freeze({
    id: 'pc-main',
    label: 'T world Shop PC Main',
    url: 'https://shop.tworld.co.kr/shop/main',
    device: 'pc',
    pageType: 'main',
    eventCategory: 'TWD_main',
    usesGaArea: false,
    requireMobileHostname: false,
    excludedActions: Object.freeze([]),
    includedFixedActions: Object.freeze([]),
  }),
  Object.freeze({
    id: 'mobile-exhibition-p00000494',
    label: 'T world Shop Mobile Exhibition P00000494',
    url: 'https://m.shop.tworld.co.kr/exhibition/view?exhibitionId=P00000494',
    device: 'mobile',
    pageType: 'exhibition',
    exhibitionId: 'P00000494',
    eventCategory: 'MTWD_exhibition - P00000494',
    usesGaArea: true,
    requireMobileHostname: true,
    excludedActions: SKT_EXHIBITION_LEGACY_ACTIONS,
    includedFixedActions: SKT_EXHIBITION_FIXED_ACTIONS,
  }),
  Object.freeze({
    id: 'pc-exhibition-p00000494',
    label: 'T world Shop PC Exhibition P00000494',
    url: 'https://shop.tworld.co.kr/exhibition/view?exhibitionId=P00000494',
    device: 'pc',
    pageType: 'exhibition',
    exhibitionId: 'P00000494',
    eventCategory: 'TWD_exhibition - P00000494',
    usesGaArea: true,
    requireMobileHostname: false,
    excludedActions: SKT_EXHIBITION_LEGACY_ACTIONS,
    includedFixedActions: SKT_EXHIBITION_FIXED_ACTIONS,
  }),
]);

const CONFIG_BY_ID = new Map(SKT_PAGE_CONFIGS.map((config) => [config.id, config]));

export function getSktPageConfig(targetId) {
  const id = String(targetId || '');
  const exact = CONFIG_BY_ID.get(id);
  if (exact) return exact;

  const mobile = id.includes('mobile');
  return {
    id,
    label: id,
    url: '',
    device: mobile ? 'mobile' : 'pc',
    pageType: 'main',
    eventCategory: mobile ? 'MTWD_main' : 'TWD_main',
    usesGaArea: false,
    requireMobileHostname: mobile,
    excludedActions: [],
    includedFixedActions: [],
  };
}

export function usesGaAreaForTargetId(targetId) {
  return Boolean(getSktPageConfig(targetId).usesGaArea);
}

export function isExcludedSktGaAction(targetId, action) {
  const normalizedAction = String(action || '').trim();
  return getSktPageConfig(targetId).excludedActions.includes(normalizedAction);
}

export function isIncludedSktFixedAction(targetId, action) {
  const normalizedAction = String(action || '').trim();
  return getSktPageConfig(targetId).includedFixedActions.includes(normalizedAction);
}
