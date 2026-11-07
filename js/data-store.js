/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * LedgerMatch — Local IndexedDB Data Store
 * Secure, private local persistence for financial sessions, invoices, payments,
 * allocations, audit trails, and user settings. Zero cloud uploads.
 */

const DB_NAME = 'LedgerMatch_DB_v1';
const DB_VERSION = 1;

let dbInstance = null;

/**
 * Initializes and returns the IndexedDB database connection.
 * @returns {Promise<IDBDatabase>}
 */
export async function getDB() {
  if (dbInstance) return dbInstance;

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = (event) => {
      console.error('IndexedDB error:', event.target.error);
      reject(event.target.error);
    };

    request.onsuccess = (event) => {
      dbInstance = event.target.result;
      resolve(dbInstance);
    };

    request.onupgradeneeded = (event) => {
      const db = event.target.result;

      // Object Store: sessions
      if (!db.objectStoreNames.contains('sessions')) {
        const sessionStore = db.createObjectStore('sessions', { keyPath: 'id' });
        sessionStore.createIndex('createdAt', 'createdAt', { unique: false });
      }

      // Object Store: invoices
      if (!db.objectStoreNames.contains('invoices')) {
        const invStore = db.createObjectStore('invoices', { keyPath: 'id' });
        invStore.createIndex('sessionId', 'sessionId', { unique: false });
        invStore.createIndex('invoice_id', 'invoice_id', { unique: false });
        invStore.createIndex('status', 'status', { unique: false });
      }

      // Object Store: payments
      if (!db.objectStoreNames.contains('payments')) {
        const payStore = db.createObjectStore('payments', { keyPath: 'id' });
        payStore.createIndex('sessionId', 'sessionId', { unique: false });
        payStore.createIndex('transaction_id', 'transaction_id', { unique: false });
        payStore.createIndex('status', 'status', { unique: false });
        payStore.createIndex('is_excluded', 'is_excluded', { unique: false });
      }

      // Object Store: allocations
      if (!db.objectStoreNames.contains('allocations')) {
        const allocStore = db.createObjectStore('allocations', { keyPath: 'id' });
        allocStore.createIndex('sessionId', 'sessionId', { unique: false });
        allocStore.createIndex('invoice_id', 'invoice_id', { unique: false });
        allocStore.createIndex('payment_id', 'payment_id', { unique: false });
      }

      // Object Store: audit_events
      if (!db.objectStoreNames.contains('audit_events')) {
        const auditStore = db.createObjectStore('audit_events', { keyPath: 'id' });
        auditStore.createIndex('sessionId', 'sessionId', { unique: false });
        auditStore.createIndex('timestamp', 'timestamp', { unique: false });
      }

      // Object Store: settings
      if (!db.objectStoreNames.contains('settings')) {
        db.createObjectStore('settings', { keyPath: 'key' });
      }
    };
  });
}

/**
 * Generic transaction helper
 */
async function performTx(storeName, mode, callback) {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, mode);
    const store = tx.objectStore(storeName);
    let result = null;

    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(new Error('Transaction aborted'));

    try {
      result = callback(store, tx);
    } catch (err) {
      reject(err);
    }
  });
}

// ==========================================
// SESSION MANAGEMENT
// ==========================================

export async function getSessions() {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('sessions', 'readonly');
    const store = tx.objectStore('sessions');
    const req = store.getAll();
    req.onsuccess = () => {
      // Sort newest first
      const list = req.result || [];
      list.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
      resolve(list);
    };
    req.onerror = () => reject(req.error);
  });
}

export async function getSession(id) {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('sessions', 'readonly');
    const req = tx.objectStore('sessions').get(id);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

export async function createSession(name, options = {}) {
  const id = 'sess_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7);
  const now = Date.now();
  const session = {
    id,
    name: name.trim() || 'New Reconciliation Session',
    createdAt: now,
    updatedAt: now,
    isDemo: Boolean(options.isDemo),
    invoiceFileMeta: options.invoiceFileMeta || null,
    paymentFileMeta: options.paymentFileMeta || null,
    settings: {
      dateToleranceDays: options.dateToleranceDays !== undefined ? options.dateToleranceDays : 30,
      currency: options.currency || 'INR'
    }
  };

  await performTx('sessions', 'readwrite', (store) => {
    store.add(session);
  });

  await setActiveSessionId(id);
  return session;
}

export async function updateSession(session) {
  session.updatedAt = Date.now();
  await performTx('sessions', 'readwrite', (store) => {
    store.put(session);
  });
  return session;
}

export async function deleteSession(sessionId) {
  const db = await getDB();
  const stores = ['sessions', 'invoices', 'payments', 'allocations', 'audit_events'];

  return new Promise((resolve, reject) => {
    const tx = db.transaction(stores, 'readwrite');
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error);

    // Delete session entity
    tx.objectStore('sessions').delete(sessionId);

    // Delete child records for this session
    for (const storeName of ['invoices', 'payments', 'allocations', 'audit_events']) {
      const store = tx.objectStore(storeName);
      const index = store.index('sessionId');
      const req = index.openKeyCursor(IDBKeyRange.only(sessionId));
      req.onsuccess = () => {
        const cursor = req.result;
        if (cursor) {
          store.delete(cursor.primaryKey);
          cursor.continue();
        }
      };
    }
  });
}

export async function getActiveSessionId() {
  return await getSetting('activeSessionId', null);
}

export async function setActiveSessionId(id) {
  return await setSetting('activeSessionId', id);
}

// ==========================================
// INVOICES STORAGE
// ==========================================

export async function getInvoices(sessionId) {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('invoices', 'readonly');
    const index = tx.objectStore('invoices').index('sessionId');
    const req = index.getAll(sessionId);
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

export async function saveInvoices(invoices) {
  if (!invoices || invoices.length === 0) return;
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('invoices', 'readwrite');
    const store = tx.objectStore('invoices');
    for (const inv of invoices) {
      store.put(inv);
    }
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error);
  });
}

export async function clearInvoices(sessionId) {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('invoices', 'readwrite');
    const store = tx.objectStore('invoices');
    const index = store.index('sessionId');
    const req = index.openKeyCursor(IDBKeyRange.only(sessionId));
    req.onsuccess = () => {
      const cursor = req.result;
      if (cursor) {
        store.delete(cursor.primaryKey);
        cursor.continue();
      }
    };
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error);
  });
}

// ==========================================
// PAYMENTS STORAGE
// ==========================================

export async function getPayments(sessionId) {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('payments', 'readonly');
    const index = tx.objectStore('payments').index('sessionId');
    const req = index.getAll(sessionId);
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

export async function savePayments(payments) {
  if (!payments || payments.length === 0) return;
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('payments', 'readwrite');
    const store = tx.objectStore('payments');
    for (const pay of payments) {
      store.put(pay);
    }
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error);
  });
}

export async function clearPayments(sessionId) {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('payments', 'readwrite');
    const store = tx.objectStore('payments');
    const index = store.index('sessionId');
    const req = index.openKeyCursor(IDBKeyRange.only(sessionId));
    req.onsuccess = () => {
      const cursor = req.result;
      if (cursor) {
        store.delete(cursor.primaryKey);
        cursor.continue();
      }
    };
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error);
  });
}

// ==========================================
// ALLOCATIONS STORAGE
// ==========================================

export async function getAllocations(sessionId) {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('allocations', 'readonly');
    const index = tx.objectStore('allocations').index('sessionId');
    const req = index.getAll(sessionId);
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

export async function saveAllocation(allocation) {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('allocations', 'readwrite');
    tx.objectStore('allocations').put(allocation);
    tx.oncomplete = () => resolve(allocation);
    tx.onerror = () => reject(tx.error);
  });
}

export async function saveAllocations(allocations) {
  if (!allocations || allocations.length === 0) return;
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('allocations', 'readwrite');
    const store = tx.objectStore('allocations');
    for (const a of allocations) {
      store.put(a);
    }
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error);
  });
}

export async function deleteAllocation(allocationId) {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('allocations', 'readwrite');
    tx.objectStore('allocations').delete(allocationId);
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error);
  });
}

export async function clearAllocations(sessionId) {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('allocations', 'readwrite');
    const store = tx.objectStore('allocations');
    const index = store.index('sessionId');
    const req = index.openKeyCursor(IDBKeyRange.only(sessionId));
    req.onsuccess = () => {
      const cursor = req.result;
      if (cursor) {
        store.delete(cursor.primaryKey);
        cursor.continue();
      }
    };
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error);
  });
}

// ==========================================
// AUDIT EVENTS STORAGE
// ==========================================

export async function getAuditEvents(sessionId) {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('audit_events', 'readonly');
    const index = tx.objectStore('audit_events').index('sessionId');
    const req = index.getAll(sessionId);
    req.onsuccess = () => {
      const list = req.result || [];
      list.sort((a, b) => b.timestamp - a.timestamp);
      resolve(list);
    };
    req.onerror = () => reject(req.error);
  });
}

export async function addAuditEvent(event) {
  const db = await getDB();
  const record = {
    id: 'evt_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7),
    timestamp: Date.now(),
    ...event
  };
  return new Promise((resolve, reject) => {
    const tx = db.transaction('audit_events', 'readwrite');
    tx.objectStore('audit_events').add(record);
    tx.oncomplete = () => resolve(record);
    tx.onerror = () => reject(tx.error);
  });
}

// ==========================================
// SETTINGS STORAGE
// ==========================================

export async function getSetting(key, defaultValue = null) {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('settings', 'readonly');
    const req = tx.objectStore('settings').get(key);
    req.onsuccess = () => {
      if (req.result && req.result.value !== undefined) {
        resolve(req.result.value);
      } else {
        resolve(defaultValue);
      }
    };
    req.onerror = () => reject(req.error);
  });
}

export async function setSetting(key, value) {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('settings', 'readwrite');
    tx.objectStore('settings').put({ key, value });
    tx.oncomplete = () => resolve(value);
    tx.onerror = () => reject(tx.error);
  });
}

// ==========================================
// BACKUP & RESTORE
// ==========================================

export async function exportSessionBackup(sessionId) {
  const session = await getSession(sessionId);
  if (!session) throw new Error('Session not found');

  const invoices = await getInvoices(sessionId);
  const payments = await getPayments(sessionId);
  const allocations = await getAllocations(sessionId);
  const auditEvents = await getAuditEvents(sessionId);

  return {
    version: '1.0',
    app: 'LedgerMatch',
    exportedAt: new Date().toISOString(),
    session,
    invoices,
    payments,
    allocations,
    auditEvents
  };
}

export async function restoreSessionBackup(backupData) {
  if (!backupData || !backupData.session) {
    throw new Error('Invalid LedgerMatch backup structure');
  }

  const db = await getDB();
  const session = { ...backupData.session };
  
  // Create a fresh ID to prevent collision if desired, or retain
  const originalId = session.id;
  const newId = 'sess_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7);
  session.id = newId;
  session.name = (session.name || 'Restored Session') + ' (Restored)';
  session.updatedAt = Date.now();

  const invoices = (backupData.invoices || []).map(inv => ({ ...inv, id: 'inv_' + Math.random().toString(36).substring(2, 9), sessionId: newId }));
  const payments = (backupData.payments || []).map(pay => ({ ...pay, id: 'pay_' + Math.random().toString(36).substring(2, 9), sessionId: newId }));
  const allocations = (backupData.allocations || []).map(a => ({ ...a, id: 'alc_' + Math.random().toString(36).substring(2, 9), sessionId: newId }));
  const auditEvents = (backupData.auditEvents || []).map(evt => ({ ...evt, id: 'evt_' + Math.random().toString(36).substring(2, 9), sessionId: newId }));

  await performTx('sessions', 'readwrite', store => store.add(session));
  await saveInvoices(invoices);
  await savePayments(payments);
  await saveAllocations(allocations);

  for (const evt of auditEvents) {
    await addAuditEvent(evt);
  }

  await setActiveSessionId(newId);
  return session;
}
