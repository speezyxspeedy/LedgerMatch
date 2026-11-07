/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * LedgerMatch — Reconciliation Orchestrator
 * Connects datasets, executes multi-level matching passes, coordinates allocations,
 * and maintains session state in IndexedDB.
 */

import { getInvoices, getPayments, getAllocations, saveInvoices, savePayments, saveAllocations } from './data-store.js';
import { recalculateAllBalances, createAllocationRecord } from './allocation-engine.js';
import { runMatchingEngine, MATCH_LEVEL } from './matching-engine.js';
import { detectDuplicates } from './duplicate-detector.js';
import { logAudit, AUDIT_EVENT_TYPE } from './audit-log.js';

/**
 * Runs a complete reconciliation cycle on the given session.
 * @param {string} sessionId 
 * @param {object} options 
 * @returns {Promise<object>} Summary of reconciliation results
 */
export async function executeReconciliation(sessionId, options = {}) {
  const {
    autoApplyLevel1 = true,
    dateToleranceDays = 30
  } = options;

  let invoices = await getInvoices(sessionId);
  let payments = await getPayments(sessionId);
  let allocations = await getAllocations(sessionId);

  // 1. Detect duplicates
  const dupResults = detectDuplicates(invoices, payments);

  // 2. Recalculate balances
  recalculateAllBalances(invoices, payments, allocations);

  // 3. Run Matching Engine
  const { suggestedMatches, manualReviewQueue } = runMatchingEngine(invoices, payments, {
    dateToleranceDays
  });

  const appliedAllocations = [];
  const stagedSuggestions = [];

  // 4. Optionally auto-apply Level 1 exact matches
  for (const match of suggestedMatches) {
    if (autoApplyLevel1 && match.level === MATCH_LEVEL.LEVEL_1_EXACT_REFERENCE && match.amountDiffPaise <= 0) {
      // Auto-apply exact reference match
      const alloc = createAllocationRecord(
        sessionId,
        match.invoice,
        match.payment,
        match.allocatedAmountPaise,
        'AUTO',
        match.reasons.join('; ')
      );
      appliedAllocations.push(alloc);
      allocations.push(alloc);
    } else {
      stagedSuggestions.push(match);
    }
  }

  // 5. Update balances with new allocations if any applied
  if (appliedAllocations.length > 0) {
    recalculateAllBalances(invoices, payments, allocations);
    await saveAllocations(appliedAllocations);
  }

  // 6. Save updated invoices and payments
  await saveInvoices(invoices);
  await savePayments(payments);

  // 7. Audit log
  await logAudit(
    sessionId,
    AUDIT_EVENT_TYPE.RECONCILIATION_RUN,
    `Reconciliation executed: ${appliedAllocations.length} auto-matches applied, ${stagedSuggestions.length} suggestions generated, ${manualReviewQueue.length} items queued for review.`,
    [],
    {
      autoAppliedCount: appliedAllocations.length,
      suggestionsCount: stagedSuggestions.length,
      reviewCount: manualReviewQueue.length,
      duplicatesFound: dupResults.groups.length
    }
  );

  return {
    invoices,
    payments,
    allocations,
    appliedAllocations,
    stagedSuggestions,
    manualReviewQueue,
    duplicateResults: dupResults
  };
}
