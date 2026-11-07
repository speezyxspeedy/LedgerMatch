/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * LedgerMatch — Core Automated Test Suite
 * Tests CSV state-machine parsing, paise currency math, multi-level matching,
 * allocation constraints, duplicate detection, and formula injection defenses.
 */

import { parseCSV, detectDelimiter } from '../js/csv-parser.js';
import { parseToPaise, formatMoney, assertSameCurrency } from '../js/money-utils.js';
import { normalizeCompanyName, calculateSimilarity, normalizeDate, getDaysDifference } from '../js/normalization.js';
import { runMatchingEngine, MATCH_LEVEL, CONFIDENCE } from '../js/matching-engine.js';
import { recalculateAllBalances, validateAllocation } from '../js/allocation-engine.js';
import { detectDuplicates } from '../js/duplicate-detector.js';
import { sanitizeAndEscapeCSVField, buildCSV } from '../js/csv-exporter.js';

export function runAllTests() {
  const results = [];

  function assert(name, condition, errorMsg = '') {
    if (condition) {
      results.push({ name, success: true, message: 'Passed' });
    } else {
      results.push({ name, success: false, message: errorMsg || 'Assertion failed' });
    }
  }

  // ==========================================
  // 1. CSV PARSING TESTS
  // ==========================================
  try {
    const csvStandard = 'id,name,amount\n1,"Acme, Inc",15000\n2,Apex,25000';
    const parsedStd = parseCSV(csvStandard);
    assert('CSV: Standard and quoted comma', parsedStd.rows.length === 2 && parsedStd.rows[0].name === 'Acme, Inc');

    const csvMultiline = 'id,memo\n1,"Line 1\nLine 2"\n2,Single';
    const parsedMulti = parseCSV(csvMultiline);
    assert('CSV: Multiline quoted field', parsedMulti.rows.length === 2 && parsedMulti.rows[0].memo.includes('\nLine 2'));

    const csvEscapedQuotes = 'id,text\n1,"He said ""Hello"""';
    const parsedQuotes = parseCSV(csvEscapedQuotes);
    assert('CSV: Escaped double quotes', parsedQuotes.rows[0].text === 'He said "Hello"');

    const csvSemicolon = 'inv;cust;amt\nINV-1;Acme;500\nINV-2;Zenith;900';
    assert('CSV: Delimiter detection (;)', detectDelimiter(csvSemicolon) === ';');
    const parsedSemi = parseCSV(csvSemicolon);
    assert('CSV: Semicolon parsing', parsedSemi.rows.length === 2 && parsedSemi.rows[1].cust === 'Zenith');

    const csvBOM = '\uFEFFcol1,col2\nval1,val2';
    const parsedBOM = parseCSV(csvBOM);
    assert('CSV: UTF-8 BOM stripping', parsedBOM.headers[0] === 'col1');

    const csvPipe = 'invoice_id|customer_name|total_amount\nINV-P1|Pipe Client|5000';
    const parsedPipe = parseCSV(csvPipe);
    assert('CSV: Pipe delimiter detection and parsing', parsedPipe.delimiter === '|' && parsedPipe.rows[0].customer_name === 'Pipe Client');

    const csvPreamble = 'Report generated: 2026-10-01\nExported from ERP\ninvoice_id,customer_name,total_amount\nINV-99,Preamble Corp,8000';
    const parsedPreamble = parseCSV(csvPreamble);
    assert('CSV: Intelligent Header Detection skipping preamble', parsedPreamble.headers.includes('invoice_id') && parsedPreamble.rows[0].customer_name === 'Preamble Corp');
  } catch (e) {
    assert('CSV Parsing Suite', false, e.message);
  }

  // ==========================================
  // 2. FINANCIAL & MONEY MATH TESTS
  // ==========================================
  try {
    // 0.1 + 0.2 floating point jitter test
    const p1 = parseToPaise('0.10'); // 10 paise
    const p2 = parseToPaise('0.20'); // 20 paise
    assert('Money: Paise integer addition (0.10 + 0.20 === 0.30)', (p1 + p2) === 30);

    const indianAmt = parseToPaise('1,50,000.50', 'INR');
    assert('Money: Indian formatted string to paise', indianAmt === 15000050);

    const negParens = parseToPaise('(5,000.00)', 'INR');
    assert('Money: Accounting parentheses as negative', negParens === -500000);

    const formattedINR = formatMoney(123456789, 'INR');
    assert('Money: Indian Numbering Format (Lakhs & Crores)', formattedINR === '₹12,34,567.89');

    let threwMismatch = false;
    try {
      assertSameCurrency('INR', 'USD');
    } catch {
      threwMismatch = true;
    }
    assert('Money: Strict currency mismatch guard', threwMismatch);
  } catch (e) {
    assert('Financial Suite', false, e.message);
  }

  // ==========================================
  // 3. NORMALIZATION & HEURISTICS TESTS
  // ==========================================
  try {
    const norm1 = normalizeCompanyName('Acme Industrial Supplies Pvt. Ltd.');
    const norm2 = normalizeCompanyName('Acme Industrial Supplies');
    assert('Normalization: Legal suffix stripping', norm1 === norm2 && norm1 === 'acme industrial supplies');

    const sim = calculateSimilarity('Apex Retail Network Ltd', 'Apex Retail Netwrk');
    assert('Normalization: High Levenshtein similarity (>= 80%)', sim >= 0.80);

    const parsedDate = normalizeDate('15/10/2026');
    assert('Normalization: DD/MM/YYYY to ISO', parsedDate === '2026-10-15');

    const daysDiff = getDaysDifference('2026-10-01', '2026-10-15');
    assert('Normalization: Calendar days difference', daysDiff === 14);
  } catch (e) {
    assert('Normalization Suite', false, e.message);
  }

  // ==========================================
  // 4. MATCHING ENGINE TESTS
  // ==========================================
  try {
    const invoices = [
      { invoice_id: 'INV-101', customer_name: 'Acme Supplies', remaining_paise: 500000, currency: 'INR', invoice_date: '2026-10-01' },
      { invoice_id: 'INV-102', customer_name: 'Bharat Tech', remaining_paise: 250000, currency: 'INR', invoice_date: '2026-10-05' }
    ];
    const payments = [
      { transaction_id: 'TXN-901', reference_id: 'INV-101', payer_name: 'Acme', unallocated_paise: 500000, currency: 'INR', payment_date: '2026-10-07' },
      { transaction_id: 'TXN-902', reference_id: '', payer_name: 'Bharat Tech', unallocated_paise: 250000, currency: 'INR', payment_date: '2026-10-10' }
    ];

    const matchRes = runMatchingEngine(invoices, payments, { dateToleranceDays: 30 });
    assert('Matching: Level 1 Exact Reference Match found',
      matchRes.suggestedMatches.some(m => m.level === MATCH_LEVEL.LEVEL_1_EXACT_REFERENCE && m.confidence === CONFIDENCE.HIGH));
    assert('Matching: Level 2 Exact Customer + Amount match found',
      matchRes.suggestedMatches.some(m => m.level === MATCH_LEVEL.LEVEL_2_EXACT_CUSTOMER_AMOUNT));
  } catch (e) {
    assert('Matching Engine Suite', false, e.message);
  }

  // ==========================================
  // 5. ALLOCATION ENGINE TESTS
  // ==========================================
  try {
    const inv = { invoice_id: 'INV-500', amount_paise: 100000, currency: 'INR' };
    const pay = { transaction_id: 'TXN-500', amount_paise: 60000, currency: 'INR' };
    const validCheck = validateAllocation(inv, pay, 60000, []);
    assert('Allocation: Valid allocation check', validCheck.valid === true);

    const overCheck = validateAllocation(inv, pay, 70000, []);
    assert('Allocation: Reject allocation exceeding payment ceiling', overCheck.valid === false);

    const testInvoices = [{ invoice_id: 'INV-A', amount_paise: 100000 }];
    const testPayments = [{ transaction_id: 'TXN-A', amount_paise: 40000 }];
    const testAllocations = [{ invoice_id: 'INV-A', payment_id: 'TXN-A', amount_paise: 40000 }];
    recalculateAllBalances(testInvoices, testPayments, testAllocations);
    assert('Allocation: Partial payment status assignment',
      testInvoices[0].status === 'PARTIALLY_PAID' && testInvoices[0].remaining_paise === 60000);
  } catch (e) {
    assert('Allocation Suite', false, e.message);
  }

  // ==========================================
  // 6. DUPLICATE DETECTOR TESTS
  // ==========================================
  try {
    const testPays = [
      { id: '1', transaction_id: 'TXN-D1', payer_name: 'Om Logistics', amount_paise: 45000, currency: 'INR', payment_date: '2026-10-16' },
      { id: '2', transaction_id: 'TXN-D1', payer_name: 'Om Logistics', amount_paise: 45000, currency: 'INR', payment_date: '2026-10-16' }
    ];
    const dups = detectDuplicates([], testPays);
    assert('Duplicates: Detect identical transaction ID', dups.groups.length > 0 && dups.duplicatePayments.length > 0);
  } catch (e) {
    assert('Duplicate Detection Suite', false, e.message);
  }

  // ==========================================
  // 7. CSV FORMULA INJECTION DEFENSE TESTS
  // ==========================================
  try {
    const safeFormula = sanitizeAndEscapeCSVField('=SUM(A1:A10)');
    assert('CSV Export: Formula injection prefix escaping (=)', safeFormula.startsWith("'="));

    const safeCmd = sanitizeAndEscapeCSVField('@cmd|/C calc');
    assert('CSV Export: Command injection prefix escaping (@)', safeCmd.startsWith("'@"));

    const normalText = sanitizeAndEscapeCSVField('Acme Corporation');
    assert('CSV Export: Normal text preserved without single quote prefix', normalText === 'Acme Corporation');
  } catch (e) {
    assert('CSV Export Defense Suite', false, e.message);
  }

  const passed = results.filter(r => r.success).length;
  const failed = results.filter(r => !r.success).length;

  return {
    passed,
    failed,
    total: results.length,
    results
  };
}
