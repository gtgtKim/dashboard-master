import analyticsData from '@google-analytics/data';
import fs from 'node:fs/promises';
import path from 'node:path';
import { getSktPageConfig, usesGaAreaForTargetId } from './skt-page-config.mjs';
import { normalizeSktGaActionForRange } from './skt-tracking-normalization.mjs';

const { BetaAnalyticsDataClient } = analyticsData;

export const GA4_CONFIG = {
  propertyId: process.env.GA4_PROPERTY_ID || '307925613',
  accountId: process.env.GA4_ACCOUNT_ID || '44615111',
  eventName: process.env.GA4_EVENT_NAME || 'click',
  dimensions: {
    eventCategory: process.env.GA4_DIMENSION_EVENT_CATEGORY || 'customEvent:event_category',
    eventAction: process.env.GA4_DIMENSION_EVENT_ACTION || 'customEvent:event_action',
    eventArea: process.env.GA4_DIMENSION_EVENT_AREA || 'customEvent:event_area',
    eventLabel: process.env.GA4_DIMENSION_EVENT_LABEL || 'customEvent:event_label',
    hostname: process.env.GA4_DIMENSION_HOSTNAME || 'hostName',
  },
  mobileHostname: process.env.GA4_MOBILE_HOSTNAME || 'm.shop.tworld.co.kr',
};

let cachedClient = null;
let cachedKeyFilename = null;

export async function queryGa4Metrics({ targetId, startDate, endDate }) {
  validateDate(startDate, 'startDate');
  validateDate(endDate, 'endDate');
  if (startDate > endDate) {
    throw new Error('startDate must be earlier than or equal to endDate.');
  }

  const keyFilename = await findGa4CredentialFile();
  if (!keyFilename) {
    throw new Error('GA4 service account key file was not found.');
  }

  const client = getGa4Client(keyFilename);
  const eventCategory = ga4CategoryForTargetId(targetId);
  const hostname = ga4HostnameForTargetId(targetId);
  const usesGaArea = usesGaAreaForTargetId(targetId);
  const dimensionFilter = {
    andGroup: {
      expressions: [
        {
          filter: {
            fieldName: 'eventName',
            stringFilter: { matchType: 'EXACT', value: GA4_CONFIG.eventName },
          },
        },
        {
          filter: {
            fieldName: GA4_CONFIG.dimensions.eventCategory,
            stringFilter: { matchType: 'EXACT', value: eventCategory },
          },
        },
      ],
    },
  };

  if (hostname) {
    dimensionFilter.andGroup.expressions.push({
      filter: {
        fieldName: GA4_CONFIG.dimensions.hostname,
        stringFilter: { matchType: 'EXACT', value: hostname },
      },
    });
  }

  const metricsSpec = [{ name: 'eventCount' }, { name: 'sessions' }, { name: 'activeUsers' }];
  const reportDimensions = [
    { name: GA4_CONFIG.dimensions.eventAction },
    ...(usesGaArea ? [{ name: GA4_CONFIG.dimensions.eventArea }] : []),
    { name: GA4_CONFIG.dimensions.eventLabel },
  ];
  const [[response], [totalResponse]] = await Promise.all([
    client.runReport({
      property: `properties/${GA4_CONFIG.propertyId}`,
      dateRanges: [{ startDate, endDate }],
      dimensions: reportDimensions,
      metrics: metricsSpec,
      dimensionFilter,
      limit: 250000,
    }),
    client.runReport({
      property: `properties/${GA4_CONFIG.propertyId}`,
      dateRanges: [{ startDate, endDate }],
      metrics: metricsSpec,
      dimensionFilter,
    }),
  ]);

  const metrics = {};

  for (const row of response.rows || []) {
    const dimensionValues = (row.dimensionValues || []).map((value) => normalizeGa4Dimension(value.value));
    const action = dimensionValues[0] || '';
    const area = usesGaArea ? dimensionValues[1] || '' : '';
    const label = dimensionValues[usesGaArea ? 2 : 1] || '';
    const canonicalAction = normalizeSktGaActionForRange({
      targetId,
      startDate,
      endDate,
      action: action || '(missing)',
    });
    const key = makeGa4MetricKey(canonicalAction, area, label);
    const rowMetrics = {
      eventCount: numberFromMetric(row.metricValues?.[0]?.value),
      sessions: numberFromMetric(row.metricValues?.[1]?.value),
      activeUsers: numberFromMetric(row.metricValues?.[2]?.value),
    };

    metrics[key] = sumGa4Metrics(metrics[key], rowMetrics);
  }

  const totalRow = totalResponse.rows?.[0];
  const totals = {
    eventCount: numberFromMetric(totalRow?.metricValues?.[0]?.value),
    sessions: numberFromMetric(totalRow?.metricValues?.[1]?.value),
    activeUsers: numberFromMetric(totalRow?.metricValues?.[2]?.value),
  };

  return {
    propertyId: GA4_CONFIG.propertyId,
    accountId: GA4_CONFIG.accountId,
    eventName: GA4_CONFIG.eventName,
    eventCategory,
    hostname,
    startDate,
    endDate,
    targetId,
    usesGaArea,
    metrics,
    totals,
    rowCount: response.rows?.length || 0,
  };
}

export async function findGa4CredentialFile() {
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    return path.resolve(process.env.GOOGLE_APPLICATION_CREDENTIALS);
  }

  const entries = await fs.readdir(process.cwd()).catch(() => []);
  const keyFile = entries.find((entry) => /^skt-otw-ua-.*\.json$/i.test(entry));
  return keyFile ? path.resolve(keyFile) : null;
}

export function ga4CategoryForTargetId(targetId) {
  return getSktPageConfig(targetId).eventCategory;
}

export function ga4HostnameForTargetId(targetId) {
  return getSktPageConfig(targetId).requireMobileHostname ? GA4_CONFIG.mobileHostname : null;
}

export function makeGa4MetricKey(action, area, label) {
  if (label === undefined) {
    label = area;
    area = '';
  }

  const encodedAction = encodeURIComponent(action || '(missing)');
  const encodedLabel = encodeURIComponent(label || '');
  if (!area) return `${encodedAction}::${encodedLabel}`;
  return `${encodedAction}::${encodeURIComponent(area)}::${encodedLabel}`;
}

export function emptyGa4Metrics() {
  return { eventCount: 0, sessions: 0, activeUsers: 0 };
}

export function numberFromMetric(value) {
  const number = Number(value || 0);
  return Number.isFinite(number) ? number : 0;
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

function normalizeGa4Dimension(value) {
  const normalized = String(value || '').trim();
  if (/^\((?:not set|not provided|not available)\)$/i.test(normalized)) return '';
  return normalized;
}

function validateDate(value, name) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) {
    throw new Error(`${name} must be YYYY-MM-DD.`);
  }
}
