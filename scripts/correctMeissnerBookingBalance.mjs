// One authorised correction, not a general payment reconciliation/backfill.
// Dry-run by default; --apply updates both linked records in one transaction.
import 'dotenv/config';
import mongoose from 'mongoose';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const ref = '261128-MEISSNER-66844';
const coreId = new mongoose.Types.ObjectId('69862b2cc745ef576f1c7713');
const boardId = new mongoose.Types.ObjectId('69862d65a22a39242309b1f3');
const apply = process.argv.includes('--apply');
const fullAmount = 2972, deposit = 980.76, remaining = 1991.24;
const snapshot = row => Object.fromEntries(Object.entries(row).filter(([key]) => [
  '_id', 'bookingId', 'bookingRef', 'totals', 'grossValue', 'balancePaid', 'balanceStatus',
  'balanceAmountPence', 'paymentStatus', 'payments', 'updatedAt',
].includes(key)));

await mongoose.connect(process.env.MONGODB_URI || process.env.MONGO_URI, { serverSelectionTimeoutMS: 15000, maxPoolSize: 2 });
const db = mongoose.connection.db;
const session = await mongoose.connection.startSession();
let auditPath, audit;
try {
  const run = async () => {
    const options = apply ? { session } : {};
    const core = await db.collection('bookings').findOne({ _id: coreId, bookingId: ref }, options);
    const board = await db.collection('bookingboarditems').findOne({ _id: boardId, bookingRef: ref }, options);
    assert.ok(core && board, 'Both exact linked booking records must exist.');
    assert.equal(String(board.bookingId), String(coreId), 'Board link changed.');
    assert.equal(core.totals?.fullAmount, fullAmount, 'Contract amount changed; review before correcting.');
    assert.equal(core.totals?.depositAmount, deposit, 'Deposit changed; review before correcting.');
    assert.equal(core.totals?.chargedAmount, deposit, 'Another payment may have arrived; do not overwrite.');
    assert.equal(core.paymentStatus, 'unpaid', 'Payment status changed; review before correcting.');
    assert.equal(core.addonPayments?.length || 0, 0, 'Add-on payment history changed.');
    assert.ok([0, fullAmount].includes(Number(board.grossValue || 0)), 'Board total changed.');
    assert.ok([0, 199124].includes(Number(core.balanceAmountPence || 0)), 'Balance changed.');
    assert.ok(!core.paidAt && !core.receiptCreatedAt && !board.paidAt && !board.receiptCreatedAt, 'New settlement evidence exists.');
    assert.ok(!board.payments || (!Array.isArray(board.payments) && !board.payments.paidAt && !board.payments.balancePaymentReceivedAt && !board.payments.receiptCreatedAt), 'Board payment evidence changed.');
    assert.ok((core.actsSummary || []).some(act => (act.selectedExtras || []).some(extra => extra.key === 'up_to_3_hours_band_member_DJ' && extra.price === 417)), 'Original contracted DJ changed.');
    const now = new Date();
    const corePatch = {
      balancePaid: false, balanceStatus: 'scheduled', balanceAmountPence: 199124,
      'totals.bookingTotal': fullAmount, 'totals.contractTotal': fullAmount,
      'totals.fullAmount': fullAmount, 'totals.addOnsPostBooking': 0,
      'totals.remainingAmount': remaining, 'totals.outstandingBalance': remaining,
      'totals.balancePaid': false, updatedAt: now,
    };
    const boardPatch = {
      grossValue: fullAmount, balancePaid: false, balanceStatus: 'scheduled',
      'payments.depositAmount': deposit, 'payments.depositChargedAmount': deposit,
      'payments.balancePaymentReceived': false, 'payments.invoicePaid': false, updatedAt: now,
    };
    if (!apply) {
      console.log(JSON.stringify({ mode: 'dry-run', bookingRef: ref, before: { core: snapshot(core), board: snapshot(board) }, planned: { core: corePatch, board: boardPatch } }, null, 2));
      return;
    }
    const directory = join(homedir(), '.codex', 'booking-corrections');
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    auditPath = join(directory, `${now.toISOString().replace(/[:.]/g, '-')}-${ref}.json`);
    audit = { bookingRef: ref, reason: 'User-authorised correction after review of original contract and confirmed deposit. DJ already included in original total; no newly recorded balance receipt.', before: { core: snapshot(core), board: snapshot(board) }, patch: { core: corePatch, board: boardPatch } };
    writeFileSync(auditPath, JSON.stringify(audit, null, 2), { mode: 0o600, flag: 'wx' });
    const coreResult = await db.collection('bookings').updateOne({ _id: coreId, updatedAt: core.updatedAt }, { $set: corePatch }, { session });
    const boardResult = await db.collection('bookingboarditems').updateOne({ _id: boardId, updatedAt: board.updatedAt }, { $set: boardPatch }, { session });
    assert.equal(coreResult.matchedCount, 1); assert.equal(boardResult.matchedCount, 1);
  };
  if (apply) {
    await session.withTransaction(run);
    writeFileSync(auditPath, JSON.stringify({ ...audit, committedAt: new Date().toISOString() }, null, 2), { mode: 0o600 });
    console.log(JSON.stringify({ mode: 'applied', bookingRef: ref, total: fullAmount, deposit, outstanding: remaining, balancePaid: false, auditPath }));
  } else await run();
} finally {
  await session.endSession();
  await mongoose.disconnect();
}
