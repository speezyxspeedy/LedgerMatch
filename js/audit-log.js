/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * LedgerMatch — Immutable Audit Trail Engine
 * Records all reconciliation runs, manual matches, allocation splits, and duplicate exclusions.
 */

import { addAuditEvent, getAuditEvents } from './data-store.js';

export const AUDIT_EVENT_TYPE = {
  DATA_IMPORT: 'DATA_IMPORT',
  RECONCILIATION_RUN: 'RECONCILIATION_RUN',
  MATCH_CONFIRMED: 'MATCH_CONFIRMED',
  ALLOCATION_CREATED: 'ALLOCATION_CREATED',
  ALLOCATION_REMOVED: 'ALLOCATION_REMOVED',
  RECORD_EXCLUDED: 'RECORD_EXCLUDED',
  RECORD_RESTORED: 'RECORD_RESTORED',
  DISCREPANCY_RESOLVED: 'DISCREPANCY_RESOLVED',
  SESSION_CREATED: 'SESSION_CREATED',
  SESSION_RESTORED: 'SESSION_RESTORED'
};

/**
 * Appends an audit event to the active session.
 * @param {string} sessionId 
 * @param {string} type 
 * @param {string} description 
 * @param {Array<string>} recordIds 
 * @param {object} diff 
 */
export async function logAudit(sessionId, type, description, recordIds = [], diff = null) {
  if (!sessionId) return null;
  const event = {
    sessionId,
    type,
    description,
    recordIds: Array.isArray(recordIds) ? recordIds : [recordIds],
    diff
  };
  return await addAuditEvent(event);
}

/**
 * Retrieves audit events for session.
 * @param {string} sessionId 
 * @returns {Promise<Array<object>>}
 */
export async function getSessionAuditLogs(sessionId) {
  return await getAuditEvents(sessionId);
}
