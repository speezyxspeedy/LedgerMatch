/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * LedgerMatch — Payment Allocation Engine
 * Supports 1-to-1, 1-to-many (splits), and many-to-1 (partial payment tranches).
 * Enforces transaction ceilings, non-destructive auditability, and zero floating-point math.
 */

import { assertSameCurrency } from './money-utils.js';

export const INVOICE_STATUS = {
  UNPAID: 'UNPAID',
  PARTIALLY_PAID: 'PARTIALLY_PAID',
  FULLY_PAID: 'FULLY_PAID',
  OVERPAID: 'OVERPAID'
};

export const PAYMENT_STATUS = {
  UNALLOCATED: 'UNALLOCATED',
  PARTIALLY_ALLOCATED: 'PARTIALLY_ALLOCATED',
  FULLY_ALLOCATED: 'FULLY_ALLOCATED',
  OVER_ALLOCATED: 'OVER_ALLOCATED'
};

/**
 * Computes live allocated sums for invoices and payments from the allocations table.
 * @param {Array<object>} invoices 
 * @param {Array<object>} payments 
 * @param {Array<object>} allocations 
 */
export function recalculateAllBalances(invoices, payments, allocations) {
  const invAllocMap = new Map();
  const payAllocMap = new Map();

  for (const inv of invoices) {
    invAllocMap.set(inv.invoice_id, 0);
  }
  for (const pay of payments) {
    payAllocMap.set(pay.transaction_id, 0);
  }

  // Aggregate active allocations
  for (const a of allocations) {
    const prevInv = invAllocMap.get(a.invoice_id) || 0;
    invAllocMap.set(a.invoice_id, prevInv + a.amount_paise);

    const prevPay = payAllocMap.get(a.payment_id) || 0;
    payAllocMap.set(a.payment_id, prevPay + a.amount_paise);
  }

  // Update Invoices in place
  for (const inv of invoices) {
    const allocated = invAllocMap.get(inv.invoice_id) || 0;
    inv.allocated_paise = allocated;
    inv.remaining_paise = Math.max(0, inv.amount_paise - allocated);

    if (allocated === 0) {
      inv.status = INVOICE_STATUS.UNPAID;
    } else if (allocated < inv.amount_paise) {
      inv.status = INVOICE_STATUS.PARTIALLY_PAID;
    } else if (allocated === inv.amount_paise) {
      inv.status = INVOICE_STATUS.FULLY_PAID;
    } else {
      inv.status = INVOICE_STATUS.OVERPAID;
    }
  }

  // Update Payments in place
  for (const pay of payments) {
    const allocated = payAllocMap.get(pay.transaction_id) || 0;
    pay.allocated_paise = allocated;
    pay.unallocated_paise = Math.max(0, pay.amount_paise - allocated);

    if (allocated === 0) {
      pay.status = PAYMENT_STATUS.UNALLOCATED;
    } else if (allocated < pay.amount_paise) {
      pay.status = PAYMENT_STATUS.PARTIALLY_ALLOCATED;
    } else if (allocated === pay.amount_paise) {
      pay.status = PAYMENT_STATUS.FULLY_ALLOCATED;
    } else {
      pay.status = PAYMENT_STATUS.OVER_ALLOCATED;
    }
  }

  return { invoices, payments, allocations };
}

/**
 * Validates whether an allocation can be applied.
 * @param {object} invoice 
 * @param {object} payment 
 * @param {number} amountPaise 
 * @param {Array<object>} existingAllocations 
 * @returns {{ valid: boolean, error?: string }}
 */
export function validateAllocation(invoice, payment, amountPaise, existingAllocations = []) {
  if (!invoice) return { valid: false, error: 'Invoice not found' };
  if (!payment) return { valid: false, error: 'Payment not found' };
  if (payment.is_excluded) return { valid: false, error: 'Excluded duplicate payments cannot be allocated' };

  if (amountPaise <= 0) {
    return { valid: false, error: 'Allocation amount must be greater than zero' };
  }

  // Currency compatibility check
  try {
    assertSameCurrency(invoice.currency, payment.currency);
  } catch (err) {
    return { valid: false, error: err.message };
  }

  // Check payment capacity
  const paymentAllocated = existingAllocations
    .filter(a => a.payment_id === payment.transaction_id)
    .reduce((sum, a) => sum + a.amount_paise, 0);

  const paymentRemaining = payment.amount_paise - paymentAllocated;
  if (amountPaise > paymentRemaining) {
    return {
      valid: false,
      error: `Allocation (${amountPaise / 100}) exceeds unallocated payment balance (${paymentRemaining / 100})`
    };
  }

  return { valid: true };
}

/**
 * Creates a new allocation entity.
 * @param {string} sessionId 
 * @param {object} invoice 
 * @param {object} payment 
 * @param {number} amountPaise 
 * @param {'AUTO'|'MANUAL'} matchType 
 * @param {string} reason 
 * @returns {object}
 */
export function createAllocationRecord(sessionId, invoice, payment, amountPaise, matchType = 'MANUAL', reason = '') {
  return {
    id: 'alc_' + Date.now() + '_' + Math.random().toString(36).substring(2, 8),
    sessionId,
    invoice_id: invoice.invoice_id,
    payment_id: payment.transaction_id,
    amount_paise: amountPaise,
    currency: invoice.currency || 'INR',
    match_type: matchType,
    reason: reason || 'Manual user reconciliation',
    timestamp: Date.now()
  };
}
