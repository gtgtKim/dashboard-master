import analyticsData from '@google-analytics/data';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  assertSktDataStartDate,
  getSktPageConfig,
  usesGaAreaForTargetId,
} from './skt-page-config.mjs';
import {
  normalizeSktGaActionForRange,
  normalizeSktGaLabelForRange,
} from './skt-tracking-normalization.mjs';

const { AlphaAnalyticsDataClient } = analyticsData.v1alpha;

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
  samplingLevel: 'UNSAMPLED',
  reportTaskLimit: Number(process.env.GA4_REPORT_TASK_LIMIT || 250000),
};

let cachedClient = null;
let cachedKeyFilename = null;
const activeQueries = new Map();

export async function queryGa4Metrics({ targetId, startDate, endDate }) {
  validateDate(startDate, 'startDate');
  validateDate(endDate, 'endDate');
  if (startDate > endDate) {
    throw new Error('startDate must be earlier than or equal to endDate.');
  }
  assertSktDataStartDate(targetId, startDate);

  const queryKey = [targetId, startDate, endDate].join(':');
  const existingQuery = activeQueries.get(queryKey);
  if (existingQuery) return existingQuery;

  const query = queryGa4MetricsUnsampled({ targetId, startDate, endDate });
  activeQueries.set(queryKey, query);

  try {
    return await query;
  } finally {
    if (activeQueries.get(queryKey) === query) activeQueries.delete(queryKey);
  }
}

async function queryGa4MetricsUnsampled({ targetId, startDate, endDate }) {
  const keyFilename = await findGa4CredentialFile();
  if (!keyFilename) {
    throw new Error('GA4 service account key file was not found.');
  }

  const client = getGa4Client(keyFilename);
  const eventCategory = ga4CategoryForTargetId(targetId);
  const hostname = ga4HostnameForTargetId(targetId);
  const usesGaArea = usesGaAreaForTargetId(targetId);
  const dimensionFilter = buildGa4DimensionFilter({ eventCategory, hostname });
  const metricsSpec = [{ name: 'eventCount' }, { name: 'sessions' }, { name: 'activeUsers' }];
  const reportDimensions = [
    { name: GA4_CONFIG.dimensions.eventAction },
    ...(usesGaArea ? [{ name: GA4_CONFIG.dimensions.eventArea }] : []),
    { name: GA4_CONFIG.dimensions.eventLabel },
  ];
  const detailReport = runUnsampledReportTask(client, {
    startDate,
    endDate,
    dimensions: reportDimensions,
    metrics: metricsSpec,
    dimensionFilter,
  });
  const actionReport = runUnsampledReportTask(client, {
    startDate,
    endDate,
    dimensions: [{ name: GA4_CONFIG.dimensions.eventAction }],
    metrics: metricsSpec,
    dimensionFilter,
  });
  const [detailResult, actionResult] = await Promise.all([detailReport, actionReport]);
  const response = detailResult.response;
  const metrics = {};
  const metricKeysByAction = new Map();

  assertUnsampledResponse(response, 'detail');
  assertUnsampledResponse(actionResult.response, 'action');

  for (const row of response.rows || []) {
    const dimensionValues = (row.dimensionValues || []).map((value, index) =>
      normalizeGa4Dimension(value.value, {
        trim: index !== (usesGaArea ? 2 : 1),
      }),
    );
    const action = dimensionValues[0] || '';
    const area = usesGaArea ? dimensionValues[1] || '' : '';
    const rawLabel = dimensionValues[usesGaArea ? 2 : 1] || '';
    const label = normalizeSktGaLabelForRange({
      targetId,
      startDate,
      endDate,
      label: rawLabel,
    });
    const canonicalAction = normalizeSktGaActionForRange({
      targetId,
      startDate,
      endDate,
      action: action || '(missing)',
    });
    const key = makeGa4MetricKey(canonicalAction, area, label);
    const rowMetrics = metricsFromGa4Row(row);

    metrics[key] = sumGa4Metrics(metrics[key], rowMetrics);
    addToSetMap(metricKeysByAction, canonicalAction, key);
  }

  const actionGroups = groupGa4ActionRows({
    rows: actionResult.response.rows || [],
    targetId,
    startDate,
    endDate,
  });
  const collisionGroups = Array.from(actionGroups.values()).filter(
    (group) => group.rawActions.size > 1,
  );
  const collisionResults = await Promise.all(
    collisionGroups.map(async (group) => {
      const aliasFilter = buildGa4DimensionFilter({
        eventCategory,
        hostname,
        actionAliases: Array.from(group.rawActions),
      });
      const [detailAliasResult, actionAliasResult] = await Promise.all([
        runUnsampledReportTask(client, {
          startDate,
          endDate,
          dimensions: [
            ...(usesGaArea ? [{ name: GA4_CONFIG.dimensions.eventArea }] : []),
            { name: GA4_CONFIG.dimensions.eventLabel },
          ],
          metrics: metricsSpec,
          dimensionFilter: aliasFilter,
        }),
        runUnsampledReportTask(client, {
          startDate,
          endDate,
          dimensions: [],
          metrics: metricsSpec,
          dimensionFilter: aliasFilter,
        }),
      ]);

      return {
        group,
        detailAliasResult,
        actionAliasResult,
      };
    }),
  );

  for (const { group, detailAliasResult, actionAliasResult } of collisionResults) {
    assertUnsampledResponse(detailAliasResult.response, `${group.canonicalAction} detail alias`);
    assertUnsampledResponse(actionAliasResult.response, `${group.canonicalAction} action alias`);
    for (const key of metricKeysByAction.get(group.canonicalAction) || []) delete metrics[key];

    for (const row of detailAliasResult.response.rows || []) {
      const area = usesGaArea
        ? normalizeGa4Dimension(row.dimensionValues?.[0]?.value)
        : '';
      const rawLabel = normalizeGa4Dimension(
        row.dimensionValues?.[usesGaArea ? 1 : 0]?.value,
        { trim: false },
      );
      const label = normalizeSktGaLabelForRange({
        targetId,
        startDate,
        endDate,
        label: rawLabel,
      });
      const key = makeGa4MetricKey(group.canonicalAction, area, label);
      metrics[key] = sumGa4Metrics(metrics[key], metricsFromGa4Row(row));
    }

    group.metrics = metricsFromGa4Row(
      actionAliasResult.response.totals?.[0] || actionAliasResult.response.rows?.[0],
    );
  }

  const actionMetrics = Object.fromEntries(
    Array.from(actionGroups.values()).map((group) => [
      makeGa4ActionMetricKey(group.canonicalAction),
      group.metrics,
    ]),
  );
  const totalRow = response.totals?.[0];
  const totals = metricsFromGa4Row(totalRow);
  const reportTaskCount = 2 + collisionResults.length * 2;

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
    actionMetrics,
    totals,
    rowCount: Number(response.rowCount || response.rows?.length || 0),
    actionRowCount: Number(actionResult.response.rowCount || actionResult.response.rows?.length || 0),
    queryMode: 'reportTasks',
    samplingLevel: GA4_CONFIG.samplingLevel,
    sampled: false,
    reportTaskCount,
  };
}

export function buildGa4DimensionFilter({ eventCategory, hostname, actionAliases = [] }) {
  const expressions = [
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
  ];

  if (hostname) {
    expressions.push({
      filter: {
        fieldName: GA4_CONFIG.dimensions.hostname,
        stringFilter: { matchType: 'EXACT', value: hostname },
      },
    });
  }

  if (actionAliases.length) {
    expressions.push({
      filter: {
        fieldName: GA4_CONFIG.dimensions.eventAction,
        inListFilter: {
          values: [...actionAliases],
          caseSensitive: true,
        },
      },
    });
  }

  return {
    andGroup: {
      expressions,
    },
  };
}

export function buildUnsampledReportDefinition({
  startDate,
  endDate,
  dimensions = [],
  metrics,
  dimensionFilter,
}) {
  return {
    dateRanges: [{ startDate, endDate }],
    dimensions,
    metrics,
    dimensionFilter,
    metricAggregations: ['TOTAL'],
    limit: GA4_CONFIG.reportTaskLimit,
    samplingLevel: GA4_CONFIG.samplingLevel,
  };
}

export async function findGa4CredentialFile() {
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    return path.resolve(process.env.GOOGLE_APPLICATION_CREDENTIALS);
  }

  const searchDirectories = [process.cwd(), path.dirname(process.cwd())];
  for (const directory of new Set(searchDirectories)) {
    const entries = await fs.readdir(directory).catch(() => []);
    const keyFile = entries.find((entry) => /^skt-otw-ua-.*\.json$/i.test(entry));
    if (keyFile) return path.join(directory, keyFile);
  }

  return null;
}

export function ga4CategoryForTargetId(targetId) {
  return getSktPageConfig(targetId).eventCategory;
}

export function ga4HostnameForTargetId(targetId) {
  const config = getSktPageConfig(targetId);
  if (config.ga4Hostname) return config.ga4Hostname;
  return config.requireMobileHostname ? GA4_CONFIG.mobileHostname : null;
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

export function makeGa4ActionMetricKey(action) {
  return encodeURIComponent(action || '(missing)');
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
    cachedClient = new AlphaAnalyticsDataClient({ keyFilename });
    cachedKeyFilename = keyFilename;
  }
  return cachedClient;
}

async function runUnsampledReportTask(client, reportOptions) {
  const [operation] = await client.createReportTask({
    parent: `properties/${GA4_CONFIG.propertyId}`,
    reportTask: {
      reportDefinition: buildUnsampledReportDefinition(reportOptions),
    },
  });
  const [task] = await operation.promise();
  const taskName = task?.name || '';
  if (!taskName) {
    throw new Error('GA4 UNSAMPLED report task did not return a task name.');
  }
  if (task.reportMetadata?.errorMessage) {
    throw new Error(`GA4 UNSAMPLED report task failed: ${task.reportMetadata.errorMessage}`);
  }

  const taskRowCount = Number(task.reportMetadata?.taskRowCount || 0);
  const totalRowCount = Number(task.reportMetadata?.totalRowCount || taskRowCount);
  if (totalRowCount > taskRowCount) {
    throw new Error(
      `GA4 UNSAMPLED report contains ${totalRowCount} rows, exceeding the ${taskRowCount}-row task result.`,
    );
  }

  const [response] = await client.queryReportTask({
    name: taskName,
    limit: GA4_CONFIG.reportTaskLimit,
  });

  return { response, task };
}

function assertUnsampledResponse(response, reportName) {
  const samplingMetadatas = response?.metadata?.samplingMetadatas || [];
  if (samplingMetadatas.length) {
    throw new Error(`GA4 ${reportName} report returned sampled data despite UNSAMPLED mode.`);
  }
}

function metricsFromGa4Row(row) {
  return {
    eventCount: numberFromMetric(row?.metricValues?.[0]?.value),
    sessions: numberFromMetric(row?.metricValues?.[1]?.value),
    activeUsers: numberFromMetric(row?.metricValues?.[2]?.value),
  };
}

function groupGa4ActionRows({ rows, targetId, startDate, endDate }) {
  const groups = new Map();

  for (const row of rows) {
    const rawAction =
      normalizeGa4Dimension(row.dimensionValues?.[0]?.value, { trim: false }) ||
      '(missing)';
    const canonicalAction = normalizeSktGaActionForRange({
      targetId,
      startDate,
      endDate,
      action: rawAction,
    });
    let group = groups.get(canonicalAction);
    if (!group) {
      group = {
        canonicalAction,
        rawActions: new Set(),
        metrics: emptyGa4Metrics(),
      };
      groups.set(canonicalAction, group);
    }

    group.rawActions.add(rawAction);
    group.metrics = sumGa4Metrics(group.metrics, metricsFromGa4Row(row));
  }

  return groups;
}

function addToSetMap(map, key, value) {
  let values = map.get(key);
  if (!values) {
    values = new Set();
    map.set(key, values);
  }
  values.add(value);
}

function sumGa4Metrics(left = emptyGa4Metrics(), right = emptyGa4Metrics()) {
  return {
    eventCount: Number(left.eventCount || 0) + Number(right.eventCount || 0),
    sessions: Number(left.sessions || 0) + Number(right.sessions || 0),
    activeUsers: Number(left.activeUsers || 0) + Number(right.activeUsers || 0),
  };
}

function normalizeGa4Dimension(value, { trim = true } = {}) {
  const rawValue = String(value || '');
  const trimmedValue = rawValue.trim();
  if (/^\((?:not set|not provided|not available)\)$/i.test(trimmedValue)) return '';
  return trim ? trimmedValue : rawValue;
}

function validateDate(value, name) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) {
    throw new Error(`${name} must be YYYY-MM-DD.`);
  }
}
