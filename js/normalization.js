/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * LedgerMatch — Normalization & String Heuristics
 * Normalizes customer names, references, and dates for multi-level reconciliation.
 */

// Common business entity suffixes to strip during normalization
const LEGAL_SUFFIXES = [
  /\bpvt\.?\s*ltd\.?\b/gi,
  /\bprivate\s+limited\b/gi,
  /\blimited\b/gi,
  /\bltd\.?\b/gi,
  /\bllc\.?\b/gi,
  /\bllp\.?\b/gi,
  /\binc\.?\b/gi,
  /\bincorporated\b/gi,
  /\bcorp\.?\b/gi,
  /\bcorporation\b/gi,
  /\bco\.?\b/gi,
  /\bcompany\b/gi,
  /\benterprises?\b/gi,
  /\bsolutions?\b/gi,
  /\bservices?\b/gi,
  /\bgroup\b/gi
];

/**
 * Normalizes a company / payer name:
 * - strips legal corporate suffixes
 * - removes special symbols & punctuation
 * - collapses consecutive whitespace
 * - converts to lowercase
 * @param {string} name 
 * @returns {string}
 */
export function normalizeCompanyName(name) {
  if (!name) return '';
  let str = String(name).trim();

  // Strip common corporate suffixes
  for (const regex of LEGAL_SUFFIXES) {
    str = str.replace(regex, ' ');
  }

  // Remove punctuation, brackets, quotes
  str = str.replace(/[^a-zA-Z0-9\s]/g, ' ');

  // Collapse whitespace
  str = str.replace(/\s+/g, ' ').trim().toLowerCase();

  return str;
}

/**
 * Normalizes reference IDs (e.g., "INV-1001" -> "1001", "REF#9001" -> "9001")
 * Keeps alphanumeric uppercase.
 * @param {string} ref 
 * @returns {string}
 */
export function normalizeReference(ref) {
  if (!ref) return '';
  let str = String(ref).trim().toUpperCase();
  // Strip common prefixes
  str = str.replace(/^(INV|INVOICE|REF|BILL|TXN|TRX|RECEIPT)[-_#:\s]*/i, '');
  // Remove non-alphanumeric
  str = str.replace(/[^A-Z0-9]/g, '');
  return str;
}

/**
 * Computes Levenshtein Distance between two strings.
 * @param {string} a 
 * @param {string} b 
 * @returns {number}
 */
export function levenshteinDistance(a, b) {
  if (a === b) return 0;
  if (!a) return b.length;
  if (!b) return a.length;

  const matrix = [];

  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i];
  }

  for (let j = 0; j <= a.length; j++) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1, // substitution
          matrix[i][j - 1] + 1,     // insertion
          matrix[i - 1][j] + 1      // deletion
        );
      }
    }
  }

  return matrix[b.length][a.length];
}

/**
 * Calculates string similarity ratio between 0.0 and 1.0 using normalized names.
 * @param {string} nameA 
 * @param {string} nameB 
 * @returns {number} 0.0 to 1.0
 */
export function calculateSimilarity(nameA, nameB) {
  const normA = normalizeCompanyName(nameA);
  const normB = normalizeCompanyName(nameB);

  if (!normA || !normB) return 0;
  if (normA === normB) return 1.0;

  // Substring inclusion heuristic (e.g. "Acme Stores" inside "Acme Stores Mumbai")
  if (normA.includes(normB) || normB.includes(normA)) {
    const minLen = Math.min(normA.length, normB.length);
    const maxLen = Math.max(normA.length, normB.length);
    if (minLen / maxLen >= 0.7) {
      return 0.90;
    }
  }

  const distance = levenshteinDistance(normA, normB);
  const maxLen = Math.max(normA.length, normB.length);
  if (maxLen === 0) return 1.0;

  const similarity = (maxLen - distance) / maxLen;
  return Math.round(similarity * 100) / 100;
}

/**
 * Parses and normalizes various date formats into standard ISO (YYYY-MM-DD).
 * Supports:
 * - YYYY-MM-DD
 * - DD/MM/YYYY
 * - MM/DD/YYYY (if day > 12 disambiguation)
 * - DD-MM-YYYY
 * - ISO timestamps
 * @param {string} dateStr 
 * @returns {string|null} ISO 'YYYY-MM-DD' or null if invalid
 */
export function normalizeDate(dateStr) {
  if (!dateStr) return null;
  const str = String(dateStr).trim();
  if (!str) return null;

  // ISO format check: 2026-10-15
  if (/^\d{4}-\d{2}-\d{2}/.test(str)) {
    const d = new Date(str.slice(0, 10));
    if (!isNaN(d.getTime())) {
      return str.slice(0, 10);
    }
  }

  // DD/MM/YYYY or DD-MM-YYYY check
  const slashParts = str.split(/[/.-]/);
  if (slashParts.length === 3) {
    let [p1, p2, p3] = slashParts.map(p => parseInt(p, 10));
    if (p3 > 1000) {
      // p3 is 4-digit year: format is either DD/MM/YYYY or MM/DD/YYYY
      let day = p1;
      let month = p2;
      const year = p3;

      if (p1 > 12 && p2 <= 12) {
        // Definitely DD/MM/YYYY
        day = p1;
        month = p2;
      } else if (p2 > 12 && p1 <= 12) {
        // Definitely MM/DD/YYYY
        day = p2;
        month = p1;
      }

      if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
        const iso = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        const d = new Date(iso);
        if (!isNaN(d.getTime())) return iso;
      }
    }
  }

  // Fallback to Date parser
  const parsed = new Date(str);
  if (!isNaN(parsed.getTime())) {
    return parsed.toISOString().slice(0, 10);
  }

  return null;
}

/**
 * Calculates calendar day difference (dateB - dateA).
 * Positive if dateB is after dateA.
 * @param {string} dateA 
 * @param {string} dateB 
 * @returns {number|null} Days diff
 */
export function getDaysDifference(dateA, dateB) {
  const normA = normalizeDate(dateA);
  const normB = normalizeDate(dateB);
  if (!normA || !normB) return null;

  const tA = new Date(normA).getTime();
  const tB = new Date(normB).getTime();
  const diffMs = tB - tA;
  return Math.round(diffMs / (1000 * 60 * 60 * 24));
}
