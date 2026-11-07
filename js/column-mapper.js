/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * LedgerMatch — Column Mapping Wizard & Schema Validator
 * Maps arbitrary user CSV headers to LedgerMatch canonical financial schemas.
 */

import { parseToPaise } from './money-utils.js';
import { normalizeDate } from './normalization.js';

export const INVOICE_SCHEMA = [
  { key: 'invoice_id', label: 'Invoice ID', required: true, aliases: ['invoice_id', 'invoice_no', 'invoice#', 'invoicenumber', 'bill_no', 'bill_id', 'inv_id', 'inv_no'] },
  { key: 'customer_name', label: 'Customer Name', required: true, aliases: ['customer_name', 'customer', 'client_name', 'client', 'buyer', 'billed_to', 'account_name', 'party_name'] },
  { key: 'invoice_date', label: 'Invoice Date', required: true, aliases: ['invoice_date', 'date', 'bill_date', 'issue_date', 'inv_date', 'created_at'] },
  { key: 'due_date', label: 'Due Date', required: false, aliases: ['due_date', 'payment_due', 'expiry_date', 'due'] },
  { key: 'total_amount', label: 'Invoice Amount', required: true, aliases: ['total_amount', 'amount', 'invoice_amount', 'bill_amount', 'total', 'grand_total', 'net_amount'] },
  { key: 'currency', label: 'Currency', required: false, aliases: ['currency', 'curr', 'currency_code', 'iso'] },
  { key: 'notes', label: 'Notes / Description', required: false, aliases: ['notes', 'description', 'memo', 'remarks', 'item_description'] }
];

export const PAYMENT_SCHEMA = [
  { key: 'transaction_id', label: 'Transaction ID', required: true, aliases: ['transaction_id', 'txn_id', 'txnid', 'reference', 'utr', 'utr_no', 'payment_id', 'receipt_no', 'cheque_no'] },
  { key: 'reference_id', label: 'Invoice Reference', required: false, aliases: ['reference_id', 'reference', 'ref_id', 'invoice_ref', 'invoice_id', 'inv_ref', 'remarks', 'narration', 'memo'] },
  { key: 'payer_name', label: 'Payer Name', required: true, aliases: ['payer_name', 'payer', 'customer_name', 'client', 'sender', 'party_name', 'remitter', 'account_name'] },
  { key: 'payment_date', label: 'Payment Date', required: true, aliases: ['payment_date', 'date', 'value_date', 'txn_date', 'settlement_date', 'deposit_date'] },
  { key: 'amount', label: 'Payment Amount', required: true, aliases: ['amount', 'payment_amount', 'credit', 'received_amount', 'deposit', 'paid_amount', 'total'] },
  { key: 'currency', label: 'Currency', required: false, aliases: ['currency', 'curr', 'currency_code', 'iso'] },
  { key: 'payment_method', label: 'Payment Method', required: false, aliases: ['payment_method', 'method', 'type', 'mode', 'channel', 'instrument'] }
];

/**
 * Automatically suggests best column mapping by fuzzy matching headers against schema aliases.
 * @param {'invoice'|'payment'} type 
 * @param {string[]} csvHeaders 
 * @returns {Record<string, string>} Map of standardKey -> csvHeaderName
 */
export function autoDetectMapping(type, csvHeaders) {
  const schema = type === 'invoice' ? INVOICE_SCHEMA : PAYMENT_SCHEMA;
  const mapping = {};
  const lowerCsvHeaders = csvHeaders.map(h => ({
    original: h,
    normalized: h.trim().toLowerCase().replace(/[^a-z0-9]/g, '')
  }));

  const usedOriginals = new Set();

  for (const field of schema) {
    let matchedOriginal = '';

    // Pass 1: Exact matches against field key or label
    for (const item of lowerCsvHeaders) {
      if (usedOriginals.has(item.original)) continue;
      const normKey = field.key.toLowerCase().replace(/[^a-z0-9]/g, '');
      const normLabel = field.label.toLowerCase().replace(/[^a-z0-9]/g, '');
      if (item.normalized === normKey || item.normalized === normLabel) {
        matchedOriginal = item.original;
        break;
      }
    }

    // Pass 2: Check aliases
    if (!matchedOriginal) {
      for (const alias of field.aliases) {
        const normAlias = alias.toLowerCase().replace(/[^a-z0-9]/g, '');
        for (const item of lowerCsvHeaders) {
          if (usedOriginals.has(item.original)) continue;
          if (item.normalized === normAlias || item.normalized.includes(normAlias)) {
            matchedOriginal = item.original;
            break;
          }
        }
        if (matchedOriginal) break;
      }
    }

    if (matchedOriginal) {
      mapping[field.key] = matchedOriginal;
      usedOriginals.add(matchedOriginal);
    } else {
      mapping[field.key] = '';
    }
  }

  return mapping;
}

/**
 * Validates the proposed mapping against sample CSV rows.
 * @param {'invoice'|'payment'} type 
 * @param {Record<string, string>} mapping 
 * @param {Array<object>} sampleRows 
 * @returns {{ isValid: boolean, missingRequired: string[], preview: Array<object>, warnings: string[] }}
 */
export function validateMapping(type, mapping, sampleRows = []) {
  const schema = type === 'invoice' ? INVOICE_SCHEMA : PAYMENT_SCHEMA;
  const missingRequired = [];
  const warnings = [];

  for (const field of schema) {
    if (field.required && (!mapping[field.key] || mapping[field.key].trim() === '')) {
      missingRequired.push(field.label);
    }
  }

  const isValid = missingRequired.length === 0;

  // Generate preview of first up to 3 parsed records
  const preview = [];
  const rowsToTest = sampleRows.slice(0, 3);

  for (const row of rowsToTest) {
    const parsedRecord = {};
    for (const field of schema) {
      const csvHeader = mapping[field.key];
      const rawVal = csvHeader ? row[csvHeader] : '';
      parsedRecord[field.key] = rawVal !== undefined ? rawVal : '';
    }

    // Test date parsing
    const dateField = type === 'invoice' ? 'invoice_date' : 'payment_date';
    if (parsedRecord[dateField]) {
      const normDate = normalizeDate(parsedRecord[dateField]);
      if (!normDate) {
        warnings.push(`Row has unparseable date in "${parsedRecord[dateField]}"`);
      }
      parsedRecord[`_${dateField}_parsed`] = normDate;
    }

    // Test amount parsing
    const amountField = type === 'invoice' ? 'total_amount' : 'amount';
    if (parsedRecord[amountField]) {
      const curr = parsedRecord.currency || 'INR';
      const paise = parseToPaise(parsedRecord[amountField], curr);
      parsedRecord[`_${amountField}_paise`] = paise;
    }

    preview.push(parsedRecord);
  }

  return {
    isValid,
    missingRequired,
    preview,
    warnings: Array.from(new Set(warnings))
  };
}
