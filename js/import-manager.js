/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * LedgerMatch — CSV Import Manager
 * Ingests invoice and payment CSV files, runs column mapping, validates types,
 * and saves canonical entities to IndexedDB.
 */

import { parseCSV } from './csv-parser.js';
import { autoDetectMapping, validateMapping } from './column-mapper.js';
import { parseToPaise } from './money-utils.js';
import { normalizeDate, normalizeCompanyName } from './normalization.js';
import { saveInvoices, savePayments, updateSession, getSession } from './data-store.js';
import { logAudit, AUDIT_EVENT_TYPE } from './audit-log.js';

/**
 * Ingests and parses Invoice CSV data with state-machine parsing, delimiter auto-detection,
 * and schema alignment.
 * @param {string} sessionId 
 * @param {string} csvText 
 * @param {string} fileName 
 * @param {Record<string, string>|null} customMapping 
 * @returns {Promise<object>}
 */
export async function importInvoiceCSV(sessionId, csvText, fileName = 'invoices.csv', customMapping = null) {
  const parseResult = parseCSV(csvText);
  if (parseResult.headers.length === 0) {
    throw new Error('CSV file is empty or has no recognizable headers');
  }

  const mapping = customMapping || autoDetectMapping('invoice', parseResult.headers);
  const validation = validateMapping('invoice', mapping, parseResult.rows);

  if (!validation.isValid) {
    return {
      requiresMapping: true,
      headers: parseResult.headers,
      mapping,
      sampleRows: parseResult.rows.slice(0, 5),
      missingRequired: validation.missingRequired,
      delimiter: parseResult.delimiter,
      headerRowIndex: parseResult.headerRowIndex,
      totalRows: parseResult.totalRows
    };
  }

  const invoices = [];
  const errors = [];

  for (let i = 0; i < parseResult.rows.length; i++) {
    const row = parseResult.rows[i];
    const lineNum = row.__row_index || (i + 2);

    const rawId = (row[mapping.invoice_id] || '').trim();
    const rawCustomer = (row[mapping.customer_name] || '').trim();
    const rawDate = row[mapping.invoice_date] || '';
    const rawDueDate = mapping.due_date ? row[mapping.due_date] : '';
    const rawAmount = row[mapping.total_amount];
    const rawCurrency = mapping.currency && row[mapping.currency] ? row[mapping.currency].trim().toUpperCase() : 'INR';
    const rawNotes = mapping.notes && row[mapping.notes] ? row[mapping.notes].trim() : '';

    if (!rawId) {
      errors.push({ line: lineNum, reason: 'Missing required Invoice ID' });
      continue;
    }

    if (!rawCustomer) {
      errors.push({ line: lineNum, reason: 'Missing required Customer Name' });
      continue;
    }

    const normDate = normalizeDate(rawDate);
    if (!normDate) {
      errors.push({ line: lineNum, reason: `Invalid invoice date: "${rawDate}"` });
      continue;
    }

    const normDueDate = normalizeDate(rawDueDate) || normDate;
    const amountPaise = parseToPaise(rawAmount, rawCurrency);

    if (amountPaise <= 0) {
      errors.push({ line: lineNum, reason: `Invalid or zero invoice amount: "${rawAmount}"` });
      continue;
    }

    invoices.push({
      id: 'inv_' + Math.random().toString(36).substring(2, 9),
      sessionId,
      invoice_id: rawId,
      customer_name: rawCustomer,
      normalized_customer: normalizeCompanyName(rawCustomer),
      invoice_date: normDate,
      due_date: normDueDate,
      amount_paise: amountPaise,
      currency: rawCurrency,
      allocated_paise: 0,
      remaining_paise: amountPaise,
      status: 'UNPAID',
      notes: rawNotes
    });
  }

  await saveInvoices(invoices);

  // Update session metadata
  const session = await getSession(sessionId);
  if (session) {
    session.invoiceFileMeta = {
      fileName,
      recordCount: invoices.length,
      delimiter: parseResult.delimiter,
      importedAt: Date.now()
    };
    await updateSession(session);
  }

  await logAudit(
    sessionId,
    AUDIT_EVENT_TYPE.DATA_IMPORT,
    `Imported ${invoices.length} invoices from "${fileName}" (Delimiter: "${parseResult.delimiter}", ${errors.length} skipped errors).`,
    invoices.map(i => i.invoice_id),
    { fileName, importedCount: invoices.length, errorsCount: errors.length, delimiter: parseResult.delimiter }
  );

  return {
    success: true,
    requiresMapping: false,
    importedCount: invoices.length,
    errorCount: errors.length,
    errors,
    delimiter: parseResult.delimiter,
    headerRowIndex: parseResult.headerRowIndex,
    invoices
  };
}

/**
 * Ingests and parses Payment CSV data with state-machine parsing, delimiter auto-detection,
 * and schema alignment.
 * @param {string} sessionId 
 * @param {string} csvText 
 * @param {string} fileName 
 * @param {Record<string, string>|null} customMapping 
 * @returns {Promise<object>}
 */
export async function importPaymentCSV(sessionId, csvText, fileName = 'payments.csv', customMapping = null) {
  const parseResult = parseCSV(csvText);
  if (parseResult.headers.length === 0) {
    throw new Error('CSV file is empty or has no recognizable headers');
  }

  const mapping = customMapping || autoDetectMapping('payment', parseResult.headers);
  const validation = validateMapping('payment', mapping, parseResult.rows);

  if (!validation.isValid) {
    return {
      requiresMapping: true,
      headers: parseResult.headers,
      mapping,
      sampleRows: parseResult.rows.slice(0, 5),
      missingRequired: validation.missingRequired,
      delimiter: parseResult.delimiter,
      headerRowIndex: parseResult.headerRowIndex,
      totalRows: parseResult.totalRows
    };
  }

  const payments = [];
  const errors = [];

  for (let i = 0; i < parseResult.rows.length; i++) {
    const row = parseResult.rows[i];
    const lineNum = row.__row_index || (i + 2);

    const rawTxnId = (row[mapping.transaction_id] || '').trim();
    const rawRefId = mapping.reference_id && row[mapping.reference_id] ? row[mapping.reference_id].trim() : '';
    const rawPayer = (row[mapping.payer_name] || '').trim();
    const rawDate = row[mapping.payment_date] || '';
    const rawAmount = row[mapping.amount];
    const rawCurrency = mapping.currency && row[mapping.currency] ? row[mapping.currency].trim().toUpperCase() : 'INR';
    const rawMethod = mapping.payment_method && row[mapping.payment_method] ? row[mapping.payment_method].trim() : 'Bank Transfer';

    if (!rawTxnId) {
      errors.push({ line: lineNum, reason: 'Missing required Transaction ID' });
      continue;
    }

    if (!rawPayer) {
      errors.push({ line: lineNum, reason: 'Missing required Payer Name' });
      continue;
    }

    const normDate = normalizeDate(rawDate);
    if (!normDate) {
      errors.push({ line: lineNum, reason: `Invalid payment date: "${rawDate}"` });
      continue;
    }

    const amountPaise = parseToPaise(rawAmount, rawCurrency);
    if (amountPaise <= 0) {
      errors.push({ line: lineNum, reason: `Invalid or zero payment amount: "${rawAmount}"` });
      continue;
    }

    payments.push({
      id: 'pay_' + Math.random().toString(36).substring(2, 9),
      sessionId,
      transaction_id: rawTxnId,
      reference_id: rawRefId,
      payer_name: rawPayer,
      normalized_payer: normalizeCompanyName(rawPayer),
      payment_date: normDate,
      amount_paise: amountPaise,
      currency: rawCurrency,
      allocated_paise: 0,
      unallocated_paise: amountPaise,
      status: 'UNALLOCATED',
      payment_method: rawMethod,
      is_duplicate: false,
      is_excluded: false
    });
  }

  await savePayments(payments);

  // Update session metadata
  const session = await getSession(sessionId);
  if (session) {
    session.paymentFileMeta = {
      fileName,
      recordCount: payments.length,
      delimiter: parseResult.delimiter,
      importedAt: Date.now()
    };
    await updateSession(session);
  }

  await logAudit(
    sessionId,
    AUDIT_EVENT_TYPE.DATA_IMPORT,
    `Imported ${payments.length} payments from "${fileName}" (Delimiter: "${parseResult.delimiter}", ${errors.length} skipped errors).`,
    payments.map(p => p.transaction_id),
    { fileName, importedCount: payments.length, errorsCount: errors.length, delimiter: parseResult.delimiter }
  );

  return {
    success: true,
    requiresMapping: false,
    importedCount: payments.length,
    errorCount: errors.length,
    errors,
    delimiter: parseResult.delimiter,
    headerRowIndex: parseResult.headerRowIndex,
    payments
  };
}
