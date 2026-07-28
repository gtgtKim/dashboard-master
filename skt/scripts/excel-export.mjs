import writeExcelFile from 'write-excel-file/node';

const MAX_EXPORT_ROWS = 10000;

export async function buildGaAttributesWorkbook(input) {
  const payload = normalizeExportPayload(input);
  const columns = exportColumns(payload.showGaArea);
  const columnCount = columns.length;
  const sheetData = [
    mergedRow('SKT GA Attributes', columnCount, {
      backgroundColor: '#1D2430',
      textColor: '#FFFFFF',
      fontSize: 16,
      fontWeight: 'bold',
      height: 28,
    }),
    metadataRow('페이지', `${payload.pageLabel} (${payload.targetId})`, columnCount),
    metadataRow('조회 기간', `${payload.startDate} ~ ${payload.endDate}`, columnCount),
    metadataRow(
      'GA4 조건',
      [
        payload.eventName,
        payload.eventCategory,
        payload.hostname ? `hostName=${payload.hostname}` : '',
      ].filter(Boolean).join(' · '),
      columnCount,
    ),
    metadataRow(
      '조회 방식',
      [payload.samplingLevel, payload.queryMode, payload.sortLabel].filter(Boolean).join(' · '),
      columnCount,
    ),
    Array(columnCount).fill(null),
    columns.map((column) =>
      styledCell(column.header, {
        backgroundColor: '#374151',
        textColor: '#FFFFFF',
        fontWeight: 'bold',
        align: 'center',
        height: 24,
      }),
    ),
  ];

  for (const sourceRow of payload.rows) {
    const rowStyle =
      sourceRow.rowType === 'total'
        ? { backgroundColor: '#FFF7DB', fontWeight: 'bold' }
        : sourceRow.rowType === 'group'
          ? { backgroundColor: '#F1F5F9', fontWeight: 'bold' }
          : {};
    sheetData.push(
      columns.map((column) => {
        const value = exportCellValue(column.key, sourceRow, payload.totals);
        return styledCell(value, {
          ...rowStyle,
          align: column.numeric ? 'right' : 'left',
          wrap: !column.numeric,
          format: column.metric ? '#,##0' : column.percent ? '0%' : column.text ? '@' : undefined,
          type: column.numeric ? Number : String,
        });
      }),
    );
  }

  const buffer = await writeExcelFile(
    sheetData,
    {
      sheet: 'GA Attributes',
      columns: columns.map((column) => ({ width: column.width })),
      orientation: 'landscape',
      stickyRowsCount: 7,
      showGridLines: false,
      zoomScale: 0.9,
    },
    {
      fontFamily: 'Arial',
      fontSize: 10,
    },
  ).toBuffer();

  return {
    buffer,
    filename: makeExcelFilename(payload),
  };
}

export function normalizeExportPayload(input) {
  const rows = Array.isArray(input?.rows) ? input.rows : [];
  if (!rows.length) throw new TypeError('At least one export row is required.');
  if (rows.length > MAX_EXPORT_ROWS) {
    throw new RangeError(`Excel export supports at most ${MAX_EXPORT_ROWS} rows.`);
  }

  const startDate = requiredDate(input?.startDate, 'startDate');
  const endDate = requiredDate(input?.endDate, 'endDate');
  if (startDate > endDate) throw new RangeError('startDate must not be later than endDate.');

  return {
    targetId: cleanText(input?.targetId, 120) || 'unknown',
    pageLabel: cleanText(input?.pageLabel, 240) || cleanText(input?.targetId, 120) || 'SKT',
    startDate,
    endDate,
    eventName: cleanText(input?.eventName, 120) || 'click',
    eventCategory: cleanText(input?.eventCategory, 240),
    hostname: cleanText(input?.hostname, 240),
    queryMode: cleanText(input?.queryMode, 120),
    samplingLevel: cleanText(input?.samplingLevel, 120),
    sortLabel: cleanText(input?.sortLabel, 120),
    showGaArea: Boolean(input?.showGaArea),
    totals: normalizeMetrics(input?.totals),
    rows: rows.map(normalizeExportRow),
  };
}

function normalizeExportRow(row) {
  const rowType = ['total', 'group', 'item'].includes(row?.rowType) ? row.rowType : 'item';
  return {
    rowType,
    action: cleanText(row?.action, 2000),
    area: cleanText(row?.area, 2000),
    label: cleanText(row?.label, 5000),
    periods: cleanText(row?.periods, 5000),
    eventCount: finiteNumber(row?.eventCount),
    sessions: finiteNumber(row?.sessions),
    activeUsers: finiteNumber(row?.activeUsers),
  };
}

function exportColumns(showGaArea) {
  return [
    { key: 'rowType', header: '구분', width: 11, text: true },
    { key: 'action', header: 'ga_action', width: 34, text: true },
    ...(showGaArea ? [{ key: 'area', header: 'ga_area', width: 30, text: true }] : []),
    { key: 'label', header: 'ga_label', width: 48, text: true },
    { key: 'periods', header: '유지 기간', width: 31, text: true },
    { key: 'eventCount', header: '이벤트 수', width: 14, numeric: true, metric: true },
    { key: 'eventPercent', header: '이벤트 비율', width: 14, numeric: true, percent: true },
    { key: 'sessions', header: '세션 수', width: 14, numeric: true, metric: true },
    { key: 'sessionPercent', header: '세션 비율', width: 14, numeric: true, percent: true },
    { key: 'activeUsers', header: '사용자 수', width: 14, numeric: true, metric: true },
    { key: 'userPercent', header: '사용자 비율', width: 14, numeric: true, percent: true },
  ];
}

function exportCellValue(key, row, totals) {
  if (key === 'rowType') {
    return row.rowType === 'total' ? '총합' : row.rowType === 'group' ? '대분류' : '요소';
  }
  if (key === 'eventPercent') return ratio(row.eventCount, totals.eventCount);
  if (key === 'sessionPercent') return ratio(row.sessions, totals.sessions);
  if (key === 'userPercent') return ratio(row.activeUsers, totals.activeUsers);
  if (['eventCount', 'sessions', 'activeUsers'].includes(key)) return row[key];
  return excelSafeText(row[key]);
}

function metadataRow(label, value, columnCount) {
  const row = Array(columnCount).fill(null);
  row[0] = styledCell(label, {
    backgroundColor: '#F3F4F6',
    fontWeight: 'bold',
    textColor: '#374151',
  });
  row[1] = styledCell(excelSafeText(value), {
    columnSpan: columnCount - 1,
    wrap: true,
    format: '@',
    type: String,
  });
  return row;
}

function mergedRow(value, columnCount, style) {
  const row = Array(columnCount).fill(null);
  row[0] = styledCell(value, { ...style, columnSpan: columnCount });
  return row;
}

function styledCell(value, style = {}) {
  const cell = {
    value,
    borderColor: '#D1D5DB',
    borderStyle: 'thin',
    alignVertical: 'top',
    ...style,
  };
  for (const key of Object.keys(cell)) {
    if (cell[key] === undefined) delete cell[key];
  }
  return cell;
}

function makeExcelFilename(payload) {
  const target = payload.targetId
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'page';
  return `skt-ga-attributes_${target}_${payload.startDate}_${payload.endDate}.xlsx`;
}

function cleanText(value, maxLength) {
  return String(value ?? '').slice(0, maxLength);
}

function excelSafeText(value) {
  const text = String(value ?? '');
  return /^[=+\-@]/.test(text) ? `'${text}` : text;
}

function normalizeMetrics(value) {
  return {
    eventCount: finiteNumber(value?.eventCount),
    sessions: finiteNumber(value?.sessions),
    activeUsers: finiteNumber(value?.activeUsers),
  };
}

function finiteNumber(value) {
  const number = Number(value || 0);
  return Number.isFinite(number) ? number : 0;
}

function ratio(value, total) {
  const denominator = finiteNumber(total);
  return denominator > 0 ? finiteNumber(value) / denominator : 0;
}

function requiredDate(value, name) {
  const text = String(value || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) throw new TypeError(`${name} must be YYYY-MM-DD.`);
  return text;
}
