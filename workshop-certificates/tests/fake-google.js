/* Minimal in-memory stand-ins for the Google Apps Script services used by Code.gs.
 * Good enough to exercise the real backend logic locally. Not a full emulation. */
'use strict';
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function makeSheet(name) {
  const sheet = {
    name,
    data: [],          // array of row arrays
    textCols: new Set(),
    frozen: 0,
    getName: () => name,
    getLastRow: () => sheet.data.length,
    getLastColumn: () => sheet.data.reduce((m, r) => Math.max(m, r.length), 0),
    getMaxRows: () => Math.max(1000, sheet.data.length),
    setFrozenRows: (n) => { sheet.frozen = n; },
    setColumnWidth: () => sheet,
    appendRow: (arr) => {
      sheet.data.push(arr.map((v, i) => coerce(v, sheet.textCols.has(i + 1))));
      return sheet;
    },
    getRange: (row, col, numRows, numCols) => makeRange(sheet, row, col, numRows || 1, numCols || 1)
  };
  return sheet;
}

/** Mimic how Sheets stores typed values: leading apostrophe forces text, dates/numbers get parsed unless text-formatted. */
function coerce(v, isText) {
  if (typeof v !== 'string') return v;
  if (v.startsWith("'")) return v.slice(1);
  if (isText) return v;
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return new Date(v + 'T00:00:00+05:30');
  if (/^-?\d+(\.\d+)?$/.test(v)) return Number(v);
  return v;
}

function makeRange(sheet, row, col, numRows, numCols) {
  const range = {
    getRow: () => row,
    getValues: () => {
      const out = [];
      for (let r = 0; r < numRows; r++) {
        const src = sheet.data[row - 1 + r] || [];
        const line = [];
        for (let c = 0; c < numCols; c++) {
          const v = src[col - 1 + c];
          line.push(v === undefined || v === null ? '' : v);
        }
        out.push(line);
      }
      return out;
    },
    setValues: (vals) => {
      vals.forEach((line, r) => {
        const idx = row - 1 + r;
        while (sheet.data.length <= idx) sheet.data.push([]);
        line.forEach((v, c) => { sheet.data[idx][col - 1 + c] = coerce(v, sheet.textCols.has(col + c)); });
      });
      return range;
    },
    setValue: (v) => range.setValues([[v]]),
    setNumberFormat: (fmt) => { if (fmt === '@') for (let c = 0; c < numCols; c++) sheet.textCols.add(col + c); return range; },
    setFontWeight: () => range,
    setBackground: () => range,
    setFontColor: () => range,
    createTextFinder: (text) => {
      let entire = false;
      const finder = {
        matchEntireCell: (b) => { entire = b; return finder; },
        findNext: () => {
          for (let r = 0; r < numRows; r++) {
            const src = sheet.data[row - 1 + r] || [];
            for (let c = 0; c < numCols; c++) {
              const v = String(src[col - 1 + c] ?? '');
              if (entire ? v === text : v.includes(text)) return makeRange(sheet, row + r, col + c, 1, 1);
            }
          }
          return null;
        }
      };
      return finder;
    }
  };
  return range;
}

function makeSpreadsheet() {
  const sheets = [makeSheet('Sheet1')];
  return {
    tz: 'Etc/GMT',
    sheets,
    setSpreadsheetTimeZone(tz) { this.tz = tz; },
    getSheetByName: (n) => sheets.find((s) => s.name === n) || null,
    insertSheet: (n) => { const s = makeSheet(n); sheets.push(s); return s; },
    getSheets: () => sheets.slice(),
    deleteSheet: (s) => { sheets.splice(sheets.indexOf(s), 1); }
  };
}

function formatDate(date, tz, fmt) {
  const tzName = tz === 'Asia/Calcutta' ? 'Asia/Kolkata' : tz;
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone: tzName, year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(date).map((p) => [p.type, p.value]));
  return fmt.replace('yyyy', parts.year).replace('yy', parts.year.slice(2)).replace('MM', parts.month).replace('dd', parts.day);
}

function loadBackend() {
  const ss = makeSpreadsheet();
  const props = {};
  const logs = [];
  const sandbox = {
    console,
    SpreadsheetApp: {
      getActive: () => ss,
      flush: () => {},
      getUi: () => { throw new Error('No UI in tests'); }
    },
    ContentService: {
      MimeType: { JSON: 'application/json' },
      createTextOutput: (s) => ({ content: s, setMimeType() { return this; } })
    },
    LockService: { getScriptLock: () => ({ waitLock: () => {}, releaseLock: () => {} }) },
    Utilities: { getUuid: () => crypto.randomUUID(), formatDate },
    PropertiesService: {
      getScriptProperties: () => ({ getProperty: (k) => props[k] || null, setProperty: (k, v) => { props[k] = v; } })
    },
    Logger: { log: (m) => logs.push(m) }
  };
  vm.createContext(sandbox);
  const src = fs.readFileSync(path.join(__dirname, '..', 'apps-script', 'Code.gs'), 'utf8');
  vm.runInContext(src, sandbox, { filename: 'Code.gs' });
  return { sandbox, ss, props, logs };
}

module.exports = { loadBackend };
