/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * LedgerMatch — Money Utilities Engine
 * Integer minor-unit arithmetic (paise/cents) to eliminate IEEE-754 floating point drift.
 */

export const CURRENCY_SYMBOLS = {
  INR: '₹',
  USD: '$',
  EUR: '€',
  GBP: '£',
  SGD: 'S$',
  AED: 'AED '
};

/**
 * Normalizes input value and converts to integer minor units (paise/cents).
 * e.g., "1,50,000.50" -> 15000050
 * e.g., -500.25 -> -50025
 * @param {string|number} val 
 * @param {string} currency 
 * @returns {number} Integer minor units
 */
export function parseToPaise(val, currency = 'INR') {
  if (val === null || val === undefined) return 0;
  if (typeof val === 'number') {
    if (isNaN(val)) return 0;
    // Scale safely using string representation to avoid float jitter
    return Math.round(val * 100);
  }

  let str = String(val).trim();
  if (!str) return 0;

  // Handle accounting parentheses: (500.00) => -500.00
  let isNegative = false;
  if (str.startsWith('(') && str.endsWith(')')) {
    isNegative = true;
    str = str.slice(1, -1).trim();
  } else if (str.startsWith('-')) {
    isNegative = true;
    str = str.slice(1).trim();
  }

  // Strip currency symbols and whitespace
  str = str.replace(/[₹$€£\sA-Za-z]/g, '');

  // Strip commas (Indian or Western grouping)
  str = str.replace(/,/g, '');

  if (!str) return 0;

  // Split into integer and decimal parts
  const parts = str.split('.');
  const integerPart = parts[0] || '0';
  let decimalPart = parts[1] || '00';

  // Pad or slice decimal part to exactly 2 digits
  if (decimalPart.length === 1) {
    decimalPart += '0';
  } else if (decimalPart.length > 2) {
    // Round third digit
    const rounded = Math.round(Number(decimalPart.slice(0, 3)) / 10);
    decimalPart = String(rounded).padStart(2, '0');
  }

  const cleanNum = parseInt(integerPart, 10) * 100 + parseInt(decimalPart, 10);
  if (isNaN(cleanNum)) return 0;

  return isNegative ? -cleanNum : cleanNum;
}

/**
 * Formats an integer minor unit amount into a localized currency string.
 * Supports Indian Numbering System (Lakhs & Crores) for INR.
 * @param {number} paise 
 * @param {string} currency 
 * @param {object} options 
 * @returns {string} Formatted currency string
 */
export function formatMoney(paise, currency = 'INR', options = {}) {
  const {
    includeSymbol = true,
    showSign = false,
    compact = false
  } = options;

  if (typeof paise !== 'number' || isNaN(paise)) {
    paise = 0;
  }

  const isNeg = paise < 0;
  const absPaise = Math.abs(paise);
  const majorUnits = absPaise / 100;
  const symbol = includeSymbol ? (CURRENCY_SYMBOLS[currency] || `${currency} `) : '';

  // Compact Indian formatting (Lakhs / Crores)
  if (compact && currency === 'INR') {
    let formattedCompact = '';
    if (absPaise >= 1000000000) { // 10 Cr
      formattedCompact = (majorUnits / 10000000).toFixed(2) + ' Cr';
    } else if (absPaise >= 10000000) { // 1 Cr
      formattedCompact = (majorUnits / 10000000).toFixed(2) + ' Cr';
    } else if (absPaise >= 1000000) { // 10 L
      formattedCompact = (majorUnits / 100000).toFixed(1) + ' L';
    } else if (absPaise >= 100000) { // 1 L
      formattedCompact = (majorUnits / 100000).toFixed(1) + ' L';
    } else if (absPaise >= 100000) { // 1k
      formattedCompact = (majorUnits / 1000).toFixed(1) + ' k';
    } else {
      formattedCompact = majorUnits.toFixed(2);
    }
    const prefix = isNeg ? '-' : (showSign && paise > 0 ? '+' : '');
    return `${prefix}${symbol}${formattedCompact}`;
  }

  const intPart = Math.floor(absPaise / 100);
  const decPart = (absPaise % 100).toString().padStart(2, '0');

  let formattedInt = '';

  if (currency === 'INR') {
    // Indian Numbering System (Last 3 digits, then groups of 2)
    const s = intPart.toString();
    if (s.length <= 3) {
      formattedInt = s;
    } else {
      const lastThree = s.slice(-3);
      const remaining = s.slice(0, -3);
      const grouped = remaining.replace(/\B(?=(\d{2})+(?!\d))/g, ',');
      formattedInt = `${grouped},${lastThree}`;
    }
  } else {
    // Standard Western Numbering (Groups of 3)
    formattedInt = intPart.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }

  const prefix = isNeg ? '-' : (showSign && paise > 0 ? '+' : '');
  return `${prefix}${symbol}${formattedInt}.${decPart}`;
}

/**
 * Converts paise back to major floating value (safe for display/charts only).
 */
export function paiseToMajor(paise) {
  if (typeof paise !== 'number' || isNaN(paise)) return 0;
  return paise / 100;
}

/**
 * Strictly ensures two amounts belong to the same currency.
 */
export function assertSameCurrency(currA, currB) {
  const normA = (currA || 'INR').trim().toUpperCase();
  const normB = (currB || 'INR').trim().toUpperCase();
  if (normA !== normB) {
    throw new Error(`Currency mismatch error: cannot reconcile ${normA} against ${normB}`);
  }
  return normA;
}

/**
 * Calculates percentage safely.
 */
export function calculatePercentage(partPaise, totalPaise) {
  if (!totalPaise || totalPaise <= 0 || !partPaise) return 0;
  const pct = (partPaise / totalPaise) * 100;
  return Math.min(100, Math.max(0, Math.round(pct * 10) / 10));
}
