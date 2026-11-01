'use strict';
const fs = require('node:fs');
const path = require('node:path');

// Server-only integration. Never send authentication fields to Google.
module.exports = function createSync({ root, read, save, fetchImpl = fetch, url = process.env.APPS_SCRIPT_URL, secret = process.env.APPS_SCRIPT_SECRET }) {
  const enabled = !!(url && secret);
  if (enabled && secret.length < 32) throw new Error('APPS_SCRIPT_SECRET must contain at least 32 characters');
  if (enabled && !/^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$/.test(url)) throw new Error('APPS_SCRIPT_URL must be a Google Apps Script /exec deployment URL');
  let running = false;
  async function flush() {
    if (!enabled || running) return;
    running = true;
    try {
      for (const user of read().users.filter(u => u.googleSync?.status === 'pending')) {
        try {
          const payment = user.payment;
          const response = await fetchImpl(url, {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, redirect: 'follow', signal: AbortSignal.timeout(30000),
            body: JSON.stringify({ secret, action: 'registration', registration: {
              id: user.id, name: user.name, email: user.email, teamName: user.teamName, createdAt: user.createdAt,
              amount: payment.amount, transactionId: payment.transactionId, paymentStatus: payment.status,
              proofType: payment.proofType, proofBase64: fs.readFileSync(path.join(root, 'data', 'payment-proofs', payment.proofFile)).toString('base64'),
            } }),
          });
          if (!response.ok || (await response.json()).ok !== true) throw new Error('Sync rejected');
          // Requests can overlap registrations or admin saves. Always update fresh data.
          const data = read();
          const saved = data.users.find(u => u.id === user.id);
          if (saved) { saved.googleSync = { status: 'synced', syncedAt: new Date().toISOString() }; save(data); }
        } catch {
          // Retain pending state on disk for retry after failures or restarts.
          console.warn('Google Apps Script sync pending; retrying automatically.');
          break;
        }
      }
    } finally { running = false; }
  }
  return { enabled, flush };
};
