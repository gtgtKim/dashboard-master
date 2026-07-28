import test from 'node:test';
import assert from 'node:assert/strict';
import readXlsxFile from 'read-excel-file/node';
import {
  buildGaAttributesWorkbook,
  normalizeExportPayload,
} from '../scripts/excel-export.mjs';

test('builds a readable xlsx workbook with totals, groups, and item rows', async () => {
  const { buffer, filename } = await buildGaAttributesWorkbook({
    targetId: 'pc-exhibition-p00000494',
    pageLabel: 'T world Shop PC Exhibition P00000494',
    startDate: '2026-07-27',
    endDate: '2026-07-27',
    eventName: 'click',
    eventCategory: 'TWD_exhibition - P00000494',
    queryMode: 'reportTasks',
    samplingLevel: 'UNSAMPLED',
    showGaArea: true,
    totals: { eventCount: 100, sessions: 80, activeUsers: 70 },
    rows: [
      {
        rowType: 'total',
        action: 'click · TWD_exhibition - P00000494',
        eventCount: 100,
        sessions: 80,
        activeUsers: 70,
      },
      {
        rowType: 'group',
        action: 'Galaxy',
        eventCount: 50,
        sessions: 40,
        activeUsers: 35,
      },
      {
        rowType: 'item',
        action: 'Galaxy',
        area: 'Fold',
        label: '자세히 보기',
        periods: '2026-07-27 ~ 2026-07-27',
        eventCount: 25,
        sessions: 20,
        activeUsers: 18,
      },
    ],
  });

  assert.match(filename, /^skt-ga-attributes_pc-exhibition-p00000494_.*\.xlsx$/);
  assert.ok(buffer.length > 1000);

  const sheets = await readXlsxFile(buffer);
  const rows = sheets[0].data;
  assert.equal(rows[0][0], 'SKT GA Attributes');
  assert.equal(rows[6].includes('ga_area'), true);
  assert.equal(rows[7][0], '총합');
  assert.equal(rows[8][0], '대분류');
  assert.equal(rows[9][0], '요소');

  const eventPercentColumn = rows[6].indexOf('이벤트 비율');
  assert.equal(rows[8][eventPercentColumn], 0.5);
});

test('validates date ranges', () => {
  const payload = normalizeExportPayload({
    targetId: 'pc-main',
    startDate: '2026-06-25',
    endDate: '2026-07-27',
    rows: [{ rowType: 'item', action: '=HYPERLINK("bad")' }],
  });

  assert.equal(payload.rows[0].action, '=HYPERLINK("bad")');
  assert.throws(
    () =>
      normalizeExportPayload({
        targetId: 'pc-main',
        startDate: '2026-07-28',
        endDate: '2026-07-27',
        rows: [{}],
      }),
    /must not be later/,
  );
});
