/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * LedgerMatch — Safe CSV Exporter
 * Implements RFC 4180 escaping and CSV Formula Injection Protection
 * against spreadsheet formula exploits (=, +, -, @, \t, \r).
 */

/**
 * Escapes a cell value and applies formula injection defenses.
 * @param {any} val 
 * @returns {string} Safe RFC 4180 escaped string
 */
export function sanitizeAndEscapeCSVField(val) {
  if (val === null || val === undefined) return '';
  let str = String(val);

  // Formula Injection Guard:
  // If field starts with =, +, -, @, tab, or carriage return, prepend a single quote (')
  if (/^[=+\-@\t\r]/.test(str)) {
    // If it's a negative number like -500.00, do not corrupt pure numbers
    if (!/^-?\d+(\.\d+)?$/.test(str)) {
      str = "'" + str;
    }
  }

  // If contains double quote, comma, or newline, wrap in quotes and escape internal quotes
  if (str.includes('"') || str.includes(',') || str.includes('\n') || str.includes('\r')) {
    str = '"' + str.replace(/"/g, '""') + '"';
  }

  return str;
}

/**
 * Builds full CSV string from headers and objects array.
 * @param {Array<{ key: string, label: string }>} columns 
 * @param {Array<object>} rows 
 * @returns {string} CSV content
 */
export function buildCSV(columns, rows) {
  const headerLine = columns.map(col => sanitizeAndEscapeCSVField(col.label)).join(',');
  const lines = [headerLine];

  for (const row of rows) {
    const rowLine = columns.map(col => {
      const val = row[col.key];
      return sanitizeAndEscapeCSVField(val);
    }).join(',');
    lines.push(rowLine);
  }

  return lines.join('\r\n');
}

/**
 * Triggers safe browser download of CSV string.
 * @param {string} filename 
 * @param {string} csvContent 
 */
export function downloadCSV(filename, csvContent) {
  // Prepend UTF-8 BOM so Excel opens non-ASCII characters properly
  const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', filename);
  link.style.visibility = 'hidden';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/**
 * High-level export helper
 */
export function exportDatasetToCSV(filename, columns, rows) {
  const content = buildCSV(columns, rows);
  downloadCSV(filename, content);
}
