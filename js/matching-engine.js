/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * LedgerMatch — Deterministic Multi-Level Reconciliation Engine
 * Executes 4-tier deterministic matching with transparent audit reasoning.
 * Zero random heuristics or black-box predictions.
 */

import { normalizeCompanyName, normalizeReference, calculateSimilarity, getDaysDifference } from './normalization.js';

export const MATCH_LEVEL = {
  LEVEL_1_EXACT_REFERENCE: 1,
  LEVEL_2_EXACT_CUSTOMER_AMOUNT: 2,
  LEVEL_3_FUZZY_CUSTOMER_DATE_AMOUNT: 3,
  LEVEL_4_MANUAL_REVIEW: 4
};

export const CONFIDENCE = {
  HIGH: 'HIGH',
  MEDIUM: 'MEDIUM',
  LOW: 'LOW'
};

/**
 * Runs deterministic matching passes over unmatched / partially paid invoices and unallocated payments.
 * @param {Array<object>} invoices 
 * @param {Array<object>} payments 
 * @param {object} options 
 * @returns {{ suggestedMatches: Array<object>, manualReviewQueue: Array<object> }}
 */
export function runMatchingEngine(invoices = [], payments = [], options = {}) {
  const {
    dateToleranceDays = 30,
    amountTolerancePercent = 0 // Strict default 0% unless specified
  } = options;

  const suggestedMatches = [];
  const manualReviewQueue = [];

  // Filter candidate pool: exclude excluded payments and fully settled invoices
  const candidateInvoices = invoices.filter(inv => inv.remaining_paise > 0);
  const candidatePayments = payments.filter(pay => !pay.is_excluded && pay.unallocated_paise > 0);

  const matchedInvoiceIds = new Set();
  const matchedPaymentIds = new Set();

  // Helper to test if already matched in this pass
  const isAvailable = (inv, pay) => !matchedInvoiceIds.has(inv.invoice_id) && !matchedPaymentIds.has(pay.transaction_id);

  // =========================================================================
  // LEVEL 1: EXACT REFERENCE MATCH
  // =========================================================================
  for (const pay of candidatePayments) {
    if (!pay.reference_id || matchedPaymentIds.has(pay.transaction_id)) continue;

    const normPayRef = normalizeReference(pay.reference_id);
    if (!normPayRef) continue;

    for (const inv of candidateInvoices) {
      if (matchedInvoiceIds.has(inv.invoice_id)) continue;
      // Currencies must be identical
      if (inv.currency !== pay.currency) continue;

      const normInvId = normalizeReference(inv.invoice_id);

      if (normPayRef === normInvId || pay.reference_id.trim().toUpperCase() === inv.invoice_id.trim().toUpperCase()) {
        const reasons = [
          `Exact reference ID match ("${pay.reference_id}" ↔ "${inv.invoice_id}")`,
          `Currency matches (${inv.currency})`
        ];

        let confidence = CONFIDENCE.HIGH;
        const daysDiff = getDaysDifference(inv.invoice_date, pay.payment_date);

        if (daysDiff !== null) {
          reasons.push(`Payment settled ${Math.abs(daysDiff)} days ${daysDiff >= 0 ? 'after' : 'before'} invoice`);
        }

        if (pay.unallocated_paise === inv.remaining_paise) {
          reasons.push('Payment amount exactly clears outstanding invoice balance');
        } else if (pay.unallocated_paise < inv.remaining_paise) {
          reasons.push(`Partial payment: covers ${(pay.unallocated_paise / inv.remaining_paise * 100).toFixed(1)}% of remaining balance`);
        } else {
          reasons.push(`Overpayment alert: payment exceeds remaining balance by ${(pay.unallocated_paise - inv.remaining_paise) / 100} ${inv.currency}`);
          confidence = CONFIDENCE.MEDIUM;
        }

        const match = {
          id: 'sug_' + inv.invoice_id + '_' + pay.transaction_id,
          level: MATCH_LEVEL.LEVEL_1_EXACT_REFERENCE,
          levelName: 'Level 1: Exact Reference Match',
          confidence,
          invoice: inv,
          payment: pay,
          reasons,
          allocatedAmountPaise: Math.min(pay.unallocated_paise, inv.remaining_paise),
          amountDiffPaise: pay.unallocated_paise - inv.remaining_paise,
          dateDiffDays: daysDiff
        };

        suggestedMatches.push(match);
        matchedInvoiceIds.add(inv.invoice_id);
        matchedPaymentIds.add(pay.transaction_id);
        break;
      }
    }
  }

  // =========================================================================
  // LEVEL 2: EXACT CUSTOMER + EXACT AMOUNT
  // =========================================================================
  for (const pay of candidatePayments) {
    if (matchedPaymentIds.has(pay.transaction_id)) continue;

    const normPayer = normalizeCompanyName(pay.payer_name);
    if (!normPayer) continue;

    // Find all invoices with exact normalized customer name and exact remaining balance
    const eligibleInvoices = candidateInvoices.filter(inv => {
      if (!isAvailable(inv, pay)) return false;
      if (inv.currency !== pay.currency) return false;
      if (inv.remaining_paise !== pay.unallocated_paise) return false;

      const normCustomer = normalizeCompanyName(inv.customer_name);
      if (normCustomer !== normPayer) return false;

      // Check date tolerance window
      const daysDiff = getDaysDifference(inv.invoice_date, pay.payment_date);
      if (daysDiff === null) return true;
      return daysDiff >= -5 && daysDiff <= dateToleranceDays; // allow up to 5 days advance or configured days after
    });

    if (eligibleInvoices.length === 1) {
      const inv = eligibleInvoices[0];
      const daysDiff = getDaysDifference(inv.invoice_date, pay.payment_date);

      const reasons = [
        `Identical company name ("${pay.payer_name}")`,
        `Exact amount match (${pay.unallocated_paise / 100} ${inv.currency})`,
        `Settled within configured date window (${daysDiff} days from invoice date)`
      ];

      suggestedMatches.push({
        id: 'sug_' + inv.invoice_id + '_' + pay.transaction_id,
        level: MATCH_LEVEL.LEVEL_2_EXACT_CUSTOMER_AMOUNT,
        levelName: 'Level 2: Exact Customer & Amount',
        confidence: CONFIDENCE.HIGH,
        invoice: inv,
        payment: pay,
        reasons,
        allocatedAmountPaise: pay.unallocated_paise,
        amountDiffPaise: 0,
        dateDiffDays: daysDiff
      });

      matchedInvoiceIds.add(inv.invoice_id);
      matchedPaymentIds.add(pay.transaction_id);
    } else if (eligibleInvoices.length > 1) {
      // Ambiguous: multiple invoices for exact same customer and amount! Send to Manual Review
      manualReviewQueue.push({
        id: 'rev_' + pay.transaction_id,
        payment: pay,
        candidateInvoices: eligibleInvoices,
        reason: `Ambiguous match: Payment matches ${eligibleInvoices.length} invoices of identical amount for ${pay.payer_name}`,
        level: MATCH_LEVEL.LEVEL_4_MANUAL_REVIEW
      });
    }
  }

  // =========================================================================
  // LEVEL 3: FUZZY CUSTOMER + DATE + AMOUNT TOLERANCE
  // =========================================================================
  for (const pay of candidatePayments) {
    if (matchedPaymentIds.has(pay.transaction_id)) continue;

    let bestInvoice = null;
    let highestSim = 0;
    let bestDaysDiff = 0;

    for (const inv of candidateInvoices) {
      if (!isAvailable(inv, pay)) return;
      if (inv.currency !== pay.currency) continue;

      const similarity = calculateSimilarity(inv.customer_name, pay.payer_name);
      if (similarity < 0.80) continue; // Must be at least 80% similar

      const daysDiff = getDaysDifference(inv.invoice_date, pay.payment_date);
      if (daysDiff !== null && (daysDiff < -7 || daysDiff > dateToleranceDays)) {
        continue; // Outside acceptable date window
      }

      // Check amount tolerance
      const amountDiff = Math.abs(inv.remaining_paise - pay.unallocated_paise);
      const isExactAmount = amountDiff === 0;
      const withinPercentTolerance = amountTolerancePercent > 0 &&
        (amountDiff / inv.remaining_paise) <= (amountTolerancePercent / 100);

      if (isExactAmount || withinPercentTolerance) {
        if (similarity > highestSim) {
          highestSim = similarity;
          bestInvoice = inv;
          bestDaysDiff = daysDiff;
        }
      }
    }

    if (bestInvoice && highestSim >= 0.80) {
      const reasons = [
        `High company name similarity (${Math.round(highestSim * 100)}% match: "${pay.payer_name}" ~ "${bestInvoice.customer_name}")`,
        `Payment amount (${pay.unallocated_paise / 100} ${pay.currency}) matches invoice outstanding`,
        `Settled within date tolerance window (${bestDaysDiff} days from invoice)`
      ];

      suggestedMatches.push({
        id: 'sug_' + bestInvoice.invoice_id + '_' + pay.transaction_id,
        level: MATCH_LEVEL.LEVEL_3_FUZZY_CUSTOMER_DATE_AMOUNT,
        levelName: 'Level 3: Fuzzy Customer & Date Match',
        confidence: CONFIDENCE.MEDIUM,
        invoice: bestInvoice,
        payment: pay,
        reasons,
        allocatedAmountPaise: Math.min(pay.unallocated_paise, bestInvoice.remaining_paise),
        amountDiffPaise: pay.unallocated_paise - bestInvoice.remaining_paise,
        dateDiffDays: bestDaysDiff,
        nameSimilarity: highestSim
      });

      matchedInvoiceIds.add(bestInvoice.invoice_id);
      matchedPaymentIds.add(pay.transaction_id);
    }
  }

  // =========================================================================
  // LEVEL 4: RESIDUAL AMBIGUOUS / UNMATCHED CANDIDATES TO MANUAL REVIEW
  // =========================================================================
  for (const pay of candidatePayments) {
    if (matchedPaymentIds.has(pay.transaction_id)) continue;
    // If payment has an unresolved reference or unidentified customer
    if (pay.reference_id && !pay.reference_id.startsWith('INV-')) {
      manualReviewQueue.push({
        id: 'rev_' + pay.transaction_id,
        payment: pay,
        candidateInvoices: [],
        reason: `Unrecognized reference number "${pay.reference_id}" requires manual verification`,
        level: MATCH_LEVEL.LEVEL_4_MANUAL_REVIEW
      });
    }
  }

  return {
    suggestedMatches,
    manualReviewQueue
  };
}
