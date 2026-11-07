/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * LedgerMatch — Institutional State-Machine CSV Parser
 * High-performance, RFC 4180-compliant deterministic Finite State Machine (FSM).
 * Handles multi-character linebreaks, multiline quoted fields, escaped double quotes,
 * intelligent delimiter auto-detection, preamble metadata skipping, and header detection.
 */

export const FSM_STATE = {
  START_RECORD: 'START_RECORD',
  START_FIELD: 'START_FIELD',
  UNQUOTED_FIELD: 'UNQUOTED_FIELD',
  QUOTED_FIELD: 'QUOTED_FIELD',
  AFTER_QUOTE: 'AFTER_QUOTE'
};

/**
 * Robustly auto-detects delimiter by analyzing unquoted character frequencies.
 * Supports comma (,), semicolon (;), tab (\t), and pipe (|).
 * @param {string} text 
 * @returns {string} One of ',', ';', '\t', '|'
 */
export function detectDelimiter(text) {
  if (!text || typeof text !== 'string') return ',';

  // Analyze the first 8KB or up to first 20 lines
  const sample = text.slice(0, 8192);
  const candidates = [',', ';', '\t', '|'];
  const score = { ',': 0, ';': 0, '\t': 0, '|': 0 };

  let inQuotes = false;
  let linesExamined = 0;

  for (let i = 0; i < sample.length; i++) {
    const ch = sample[i];

    if (ch === '"') {
      // Toggle quote state
      if (inQuotes && sample[i + 1] === '"') {
        i++; // skip escaped quote
      } else {
        inQuotes = !inQuotes;
      }
    } else if (!inQuotes) {
      if (score[ch] !== undefined) {
        score[ch]++;
      } else if (ch === '\n') {
        linesExamined++;
        if (linesExamined >= 20) break;
      }
    }
  }

  // Find delimiter with highest count
  let best = ',';
  let maxCount = 0;
  for (const delim of candidates) {
    if (score[delim] > maxCount) {
      maxCount = score[delim];
      best = delim;
    }
  }

  return best;
}

/**
 * Intelligent Header Detection:
 * Detects whether the first row or an initial preamble row contains headers.
 * Looks for known financial identifiers like 'id', 'invoice', 'txn', 'customer', 'amount', 'date', 'ref'.
 * @param {Array<Array<string>>} rawRows 
 * @returns {number} 0-based index of the detected header row, default 0
 */
export function detectHeaderRowIndex(rawRows) {
  if (!rawRows || rawRows.length === 0) return 0;

  const headerKeywords = [
    'id', 'invoice', 'invoice_id', 'inv', 'bill', 'bill_no',
    'txn', 'transaction', 'transaction_id', 'ref', 'reference',
    'customer', 'payer', 'client', 'vendor', 'name',
    'amount', 'total', 'total_amount', 'balance', 'credit', 'debit',
    'date', 'invoice_date', 'due_date', 'payment_date', 'currency'
  ];

  // Check up to the first 5 rows
  const maxInspect = Math.min(5, rawRows.length);
  let bestScore = -1;
  let bestIndex = 0;

  for (let r = 0; r < maxInspect; r++) {
    const row = rawRows[r];
    if (!row || row.length <= 1) continue;

    let matchCount = 0;
    for (const cell of row) {
      const clean = (cell || '').trim().toLowerCase().replace(/[^a-z0-9_]/g, '');
      if (headerKeywords.includes(clean) || headerKeywords.some(kw => clean.includes(kw))) {
        matchCount++;
      }
    }

    if (matchCount > bestScore) {
      bestScore = matchCount;
      bestIndex = r;
    }
  }

  return bestScore > 0 ? bestIndex : 0;
}

/**
 * Deterministic State-Machine CSV Parser (RFC 4180 compliant)
 * @param {string} csvText 
 * @param {object} options 
 * @returns {{
 *   headers: string[],
 *   rows: Array<object>,
 *   rawRows: Array<Array<string>>,
 *   errors: Array<{ line: number, message: string }>,
 *   warnings: Array<string>,
 *   delimiter: string,
 *   headerRowIndex: number,
 *   totalRows: number
 * }}
 */
export function parseCSV(csvText, options = {}) {
  if (!csvText || typeof csvText !== 'string') {
    return {
      headers: [],
      rows: [],
      rawRows: [],
      errors: [],
      warnings: [],
      delimiter: ',',
      headerRowIndex: 0,
      totalRows: 0
    };
  }

  // 1. Strip UTF-8 Byte Order Mark (BOM) if present (\uFEFF)
  let text = csvText;
  if (text.charCodeAt(0) === 0xFEFF) {
    text = text.slice(1);
  }

  // 2. Determine delimiter
  const delimiter = options.delimiter || detectDelimiter(text);

  const rawRows = [];
  const errors = [];
  const warnings = [];

  let currentRow = [];
  let currentField = '';
  let state = FSM_STATE.START_RECORD;
  let lineNum = 1;
  let fieldStartLine = 1;

  const len = text.length;

  // State-Machine Processing Loop
  for (let i = 0; i < len; i++) {
    const ch = text[i];
    const nextCh = i + 1 < len ? text[i + 1] : '';

    if (ch === '\n') {
      lineNum++;
    }

    switch (state) {
      case FSM_STATE.START_RECORD:
        if (ch === '\r') {
          if (nextCh === '\n') i++; // Skip \r\n
          break; // Empty line
        }
        if (ch === '\n') {
          break; // Empty line
        }
        currentRow = [];
        currentField = '';
        fieldStartLine = lineNum;

        if (ch === '"') {
          state = FSM_STATE.QUOTED_FIELD;
        } else if (ch === delimiter) {
          currentRow.push('');
          state = FSM_STATE.START_FIELD;
        } else {
          currentField += ch;
          state = FSM_STATE.UNQUOTED_FIELD;
        }
        break;

      case FSM_STATE.START_FIELD:
        currentField = '';
        fieldStartLine = lineNum;

        if (ch === '"') {
          state = FSM_STATE.QUOTED_FIELD;
        } else if (ch === delimiter) {
          currentRow.push('');
          state = FSM_STATE.START_FIELD;
        } else if (ch === '\r') {
          if (nextCh === '\n') i++;
          currentRow.push('');
          rawRows.push(currentRow);
          state = FSM_STATE.START_RECORD;
        } else if (ch === '\n') {
          currentRow.push('');
          rawRows.push(currentRow);
          state = FSM_STATE.START_RECORD;
        } else {
          currentField += ch;
          state = FSM_STATE.UNQUOTED_FIELD;
        }
        break;

      case FSM_STATE.UNQUOTED_FIELD:
        if (ch === delimiter) {
          currentRow.push(currentField.trim());
          state = FSM_STATE.START_FIELD;
        } else if (ch === '\r') {
          if (nextCh === '\n') i++;
          currentRow.push(currentField.trim());
          rawRows.push(currentRow);
          state = FSM_STATE.START_RECORD;
        } else if (ch === '\n') {
          currentRow.push(currentField.trim());
          rawRows.push(currentRow);
          state = FSM_STATE.START_RECORD;
        } else {
          currentField += ch;
        }
        break;

      case FSM_STATE.QUOTED_FIELD:
        if (ch === '"') {
          if (nextCh === '"') {
            // RFC 4180 Escaped Quote ("" becomes ")
            currentField += '"';
            i++; // skip next quote
          } else {
            // End of quoted field
            state = FSM_STATE.AFTER_QUOTE;
          }
        } else {
          // Multiline linebreaks or delimiters inside quotes preserved verbatim
          currentField += ch;
        }
        break;

      case FSM_STATE.AFTER_QUOTE:
        if (ch === delimiter) {
          currentRow.push(currentField);
          state = FSM_STATE.START_FIELD;
        } else if (ch === '\r') {
          if (nextCh === '\n') i++;
          currentRow.push(currentField);
          rawRows.push(currentRow);
          state = FSM_STATE.START_RECORD;
        } else if (ch === '\n') {
          currentRow.push(currentField);
          rawRows.push(currentRow);
          state = FSM_STATE.START_RECORD;
        } else if (ch === ' ' || ch === '\t') {
          // Tolerated whitespace after closing quote
        } else {
          // Malformed RFC 4180
          errors.push({
            line: lineNum,
            message: `Unexpected character '${ch}' after closing quote at line ${lineNum}`
          });
          currentField += ch;
          state = FSM_STATE.UNQUOTED_FIELD;
        }
        break;
    }
  }

  // Handle stream EOF
  if (state === FSM_STATE.QUOTED_FIELD) {
    errors.push({
      line: fieldStartLine,
      message: `Unclosed quoted field detected starting at line ${fieldStartLine}`
    });
    currentRow.push(currentField);
    rawRows.push(currentRow);
  } else if (state === FSM_STATE.UNQUOTED_FIELD || state === FSM_STATE.AFTER_QUOTE) {
    currentRow.push(currentField.trim());
    rawRows.push(currentRow);
  } else if (state === FSM_STATE.START_FIELD) {
    currentRow.push('');
    rawRows.push(currentRow);
  }

  if (rawRows.length === 0) {
    return {
      headers: [],
      rows: [],
      rawRows: [],
      errors,
      warnings,
      delimiter,
      headerRowIndex: 0,
      totalRows: 0
    };
  }

  // Header row resolution
  const headerRowIndex = options.headerRowIndex !== undefined ? options.headerRowIndex : detectHeaderRowIndex(rawRows);
  const rawHeaders = rawRows[headerRowIndex] || [];
  const headers = rawHeaders.map((h, idx) => {
    const clean = (h || '').trim();
    return clean || `col_${idx + 1}`;
  });

  const rows = [];
  for (let r = headerRowIndex + 1; r < rawRows.length; r++) {
    const rawCols = rawRows[r];
    // Skip empty lines
    if (rawCols.length === 1 && rawCols[0] === '') continue;

    const rowObj = {};
    for (let c = 0; c < headers.length; c++) {
      const headerKey = headers[c];
      rowObj[headerKey] = c < rawCols.length ? rawCols[c] : '';
    }
    rowObj.__row_index = r + 1;
    rows.push(rowObj);
  }

  return {
    headers,
    rows,
    rawRows,
    errors,
    warnings,
    delimiter,
    headerRowIndex,
    totalRows: rows.length
  };
}
