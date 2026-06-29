import analyticsData from '@google-analytics/data';
import fs from 'node:fs/promises';
import path from 'node:path';

const { BetaAnalyticsDataClient } = analyticsData;

export const GA4_CONFIG = {
  propertyId: process.env.GA4_PROPERTY_ID || '307903899',
  accountId: process.env.GA4_ACCOUNT_ID || '49553718',
  dimensions: {
    dataCategory: process.env.GA4_DIMENSION_DATA_CATEGORY || 'customEvent:dataCategory',
    dataAction: process.env.GA4_DIMENSION_DATA_ACTION || 'customEvent:dataAction',
    dataArea: process.env.GA4_DIMENSION_DATA_AREA || 'customEvent:dataArea',
    dataLabel: process.env.GA4_DIMENSION_DATA_LABEL || 'customEvent:dataLabel',
    deviceCategory: process.env.GA4_DIMENSION_DEVICE_CATEGORY || 'deviceCategory',
    pagePath: process.env.GA4_DIMENSION_PAGE_PATH || 'pagePath',
    itemName: process.env.GA4_DIMENSION_ITEM_NAME || 'itemName',
  },
  events: {
    homepage: process.env.GA4_EVENT_HOMEPAGE || 'click_homepage',
    navigation: process.env.GA4_EVENT_NAVIGATION || 'click_nav',
    wishlist: process.env.GA4_EVENT_WISHLIST || 'add_to_wishlist',
  },
  homepageCategory: process.env.GA4_HOMEPAGE_CATEGORY || 'Homepage',
  navigationCategory: process.env.GA4_NAVIGATION_CATEGORY || 'Navigation',
  wishlistPagePath: process.env.GA4_WISHLIST_PAGE_PATH || '/us/en',
};

const METRICS_SPEC = [{ name: 'eventCount' }, { name: 'sessions' }, { name: 'activeUsers' }];
const SESSION_USER_METRICS = [{ name: 'sessions' }, { name: 'activeUsers' }];
let cachedClient = null;
let cachedKeyFilename = null;

export async function queryGa4Metrics({ targetId, startDate, endDate }) {
  validateDate(startDate, 'startDate');
  validateDate(endDate, 'endDate');
  if (startDate > endDate) {
    throw new Error('startDate must be earlier than or equal to endDate.');
  }
  if (!GA4_CONFIG.propertyId) {
    throw new Error('GA4_PROPERTY_ID is required.');
  }

  const keyFilename = await findGa4CredentialFile();
  if (!keyFilename) {
    throw new Error('GA4 service account key file was not found.');
  }

  const client = getGa4Client(keyFilename);
  const deviceCategory = deviceCategoryForTargetId(targetId);
  const [
    homepageResponse,
    navigationResponse,
    wishlistItemResponse,
    allEventsTotalResponse,
    wishlistTotalResponse,
  ] = await Promise.all([
    runRowsReport(client, {
      startDate,
      endDate,
      dimensions: [
        GA4_CONFIG.dimensions.dataCategory,
        GA4_CONFIG.dimensions.dataAction,
        GA4_CONFIG.dimensions.dataArea,
        GA4_CONFIG.dimensions.dataLabel,
      ],
      dimensionFilter: homepageFilter(deviceCategory),
    }),
    runRowsReport(client, {
      startDate,
      endDate,
      dimensions: [
        GA4_CONFIG.dimensions.dataCategory,
        GA4_CONFIG.dimensions.dataAction,
        GA4_CONFIG.dimensions.dataLabel,
      ],
      dimensionFilter: navigationFilter(deviceCategory),
    }),
    runRowsReport(client, {
      startDate,
      endDate,
      dimensions: [GA4_CONFIG.dimensions.itemName],
      metrics: SESSION_USER_METRICS,
      dimensionFilter: wishlistFilter(deviceCategory),
    }),
    runTotalsReport(client, {
      startDate,
      endDate,
      dimensionFilter: allEventsTotalFilter(deviceCategory),
    }),
    runTotalsReport(client, {
      startDate,
      endDate,
      dimensionFilter: wishlistFilter(deviceCategory),
    }),
  ]);

  const metrics = {};
  mergeHomepageMetrics(metrics, homepageResponse);
  mergeNavigationMetrics(metrics, navigationResponse);
  mergeWishlistItemMetrics(metrics, wishlistItemResponse);

  const allEventsTotals = metricsFromRow(allEventsTotalResponse.rows?.[0]);
  const wishlistTotals = metricsFromRow(wishlistTotalResponse.rows?.[0]);

  return {
    propertyId: GA4_CONFIG.propertyId,
    accountId: GA4_CONFIG.accountId,
    targetId,
    startDate,
    endDate,
    deviceCategory,
    eventNames: Object.values(GA4_CONFIG.events),
    metrics,
    groupMetrics: {
      wishlist: wishlistTotals,
    },
    totals: allEventsTotals,
    warnings: [],
    rowCount:
      Number(homepageResponse.rows?.length || 0) +
      Number(navigationResponse.rows?.length || 0) +
      Number(wishlistItemResponse.rows?.length || 0),
  };
}

async function runRowsReport(client, { startDate, endDate, dimensions, dimensionFilter, metrics = METRICS_SPEC }) {
  const [response] = await client.runReport({
    property: `properties/${GA4_CONFIG.propertyId}`,
    dateRanges: [{ startDate, endDate }],
    dimensions: dimensions.map((name) => ({ name })),
    metrics,
    dimensionFilter,
    limit: 250000,
  });
  return response;
}

async function runTotalsReport(client, { startDate, endDate, dimensionFilter }) {
  const [response] = await client.runReport({
    property: `properties/${GA4_CONFIG.propertyId}`,
    dateRanges: [{ startDate, endDate }],
    metrics: METRICS_SPEC,
    dimensionFilter,
  });
  return response;
}

function mergeHomepageMetrics(metrics, response) {
  for (const row of response.rows || []) {
    const [category = '', action = '', area = '', label = ''] = dimensionsFromRow(row);
    const key = makeGa4MetricKey(category, action, area, label);
    metrics[key] = sumGa4Metrics(metrics[key], metricsFromRow(row));
  }
}

function mergeNavigationMetrics(metrics, response) {
  for (const row of response.rows || []) {
    const [category = '', action = '', label = ''] = dimensionsFromRow(row);
    const key = makeGa4MetricKey(category, action, '', label);
    metrics[key] = sumGa4Metrics(metrics[key], metricsFromRow(row));
  }
}

function mergeWishlistItemMetrics(metrics, response) {
  for (const row of response.rows || []) {
    const [itemName = ''] = dimensionsFromRow(row);
    if (!itemName) continue;
    const key = makeGa4MetricKey('ecommerce', GA4_CONFIG.events.wishlist, '', itemName);
    const rowMetrics = {
      eventCount: null,
      sessions: numberFromMetric(row.metricValues?.[0]?.value),
      activeUsers: numberFromMetric(row.metricValues?.[1]?.value),
    };
    metrics[key] = sumGa4Metrics(metrics[key], rowMetrics);
  }
}

function homepageFilter(deviceCategory) {
  return andFilter([
    exactFilter('eventName', GA4_CONFIG.events.homepage),
    exactFilter(GA4_CONFIG.dimensions.deviceCategory, deviceCategory),
    exactFilter(GA4_CONFIG.dimensions.dataCategory, GA4_CONFIG.homepageCategory),
  ]);
}

function navigationFilter(deviceCategory) {
  return andFilter([
    exactFilter('eventName', GA4_CONFIG.events.navigation),
    exactFilter(GA4_CONFIG.dimensions.deviceCategory, deviceCategory),
    exactFilter(GA4_CONFIG.dimensions.dataCategory, GA4_CONFIG.navigationCategory),
  ]);
}

function wishlistFilter(deviceCategory) {
  return andFilter([
    exactFilter('eventName', GA4_CONFIG.events.wishlist),
    exactFilter(GA4_CONFIG.dimensions.deviceCategory, deviceCategory),
    exactFilter(GA4_CONFIG.dimensions.pagePath, GA4_CONFIG.wishlistPagePath),
  ]);
}

function totalFilter(deviceCategory) {
  return allEventsTotalFilter(deviceCategory);
}

function allEventsTotalFilter(deviceCategory) {
  return andFilter([
    exactFilter(GA4_CONFIG.dimensions.deviceCategory, deviceCategory),
    {
      orGroup: {
        expressions: [
          homepageFilter(deviceCategory),
          navigationFilter(deviceCategory),
          wishlistFilter(deviceCategory),
        ],
      },
    },
  ]);
}

function andFilter(expressions) {
  return { andGroup: { expressions } };
}

function exactFilter(fieldName, value) {
  return {
    filter: {
      fieldName,
      stringFilter: { matchType: 'EXACT', value: String(value || '') },
    },
  };
}

function dimensionsFromRow(row) {
  return (row.dimensionValues || []).map((value) => cleanDimensionValue(value.value || ''));
}

function metricsFromRow(row) {
  return {
    eventCount: numberFromMetric(row?.metricValues?.[0]?.value),
    sessions: numberFromMetric(row?.metricValues?.[1]?.value),
    activeUsers: numberFromMetric(row?.metricValues?.[2]?.value),
  };
}

export async function findGa4CredentialFile() {
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    return path.resolve(process.env.GOOGLE_APPLICATION_CREDENTIALS);
  }

  const entries = await fs.readdir(process.cwd()).catch(() => []);
  const keyFile = entries.find((entry) => /(ga4|analytics|service-account|gyutae-test-project).*\.json$/i.test(entry));
  return keyFile ? path.resolve(keyFile) : null;
}

export function deviceCategoryForTargetId(targetId) {
  return String(targetId).includes('mobile') ? 'mobile' : 'desktop';
}

export function makeGa4MetricKey(category, action, area, label) {
  const normalizedCategory = category || '(missing)';
  const normalizedAction = action || '(missing)';

  if (normalizedAction === GA4_CONFIG.events.wishlist || normalizedCategory === 'ecommerce') {
    return ['wishlist', label || ''].map(encodeMetricPart).join('::');
  }

  if (normalizedCategory === GA4_CONFIG.navigationCategory) {
    return ['navigation', normalizedCategory, normalizedAction, label || ''].map(encodeMetricPart).join('::');
  }

  return ['homepage', normalizedCategory, normalizedAction, area || '', label || ''].map(encodeMetricPart).join('::');
}

export function emptyGa4Metrics() {
  return { eventCount: 0, sessions: 0, activeUsers: 0 };
}

export function numberFromMetric(value) {
  const number = Number(value || 0);
  return Number.isFinite(number) ? number : 0;
}

function encodeMetricPart(value) {
  return encodeURIComponent(value || '');
}

function cleanDimensionValue(value) {
  const text = String(value || '');
  return text === 'no value' || text === '(not set)' ? '' : text;
}

function getGa4Client(keyFilename) {
  if (!cachedClient || cachedKeyFilename !== keyFilename) {
    cachedClient = new BetaAnalyticsDataClient({ keyFilename });
    cachedKeyFilename = keyFilename;
  }
  return cachedClient;
}

function sumGa4Metrics(left = emptyGa4Metrics(), right = emptyGa4Metrics()) {
  return {
    eventCount: Number(left.eventCount || 0) + Number(right.eventCount || 0),
    sessions: Number(left.sessions || 0) + Number(right.sessions || 0),
    activeUsers: Number(left.activeUsers || 0) + Number(right.activeUsers || 0),
  };
}

function validateDate(value, name) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) {
    throw new Error(`${name} must be YYYY-MM-DD.`);
  }
}
