import test from 'node:test';
import assert from 'node:assert/strict';
import { withConfirmedAllocation, getLineupMembersForPdf } from '../routes/bookingRoutes.js';
import { buildIntroEmail } from '../routes/bookingBoardRoutes.js';
const board = { _id: '699999999999999999999999', bookingRef: 'EXAMPLE', agent: 'Encore',
  grossValue: 3255, originalBookingTotal: 2615, lineupSelected: 'Bespoke 4-piece', bandSize: 4,
  lineupComposition: ['Lead Vocal / Rapper', 'Electric Guitar', 'Drums', 'Bass Guitar'],
  extras: [{ name: 'Saxophone', price: 640, addsMusician: true, quantity: 1 }],
  payments: { depositChargedAmount: 563, extrasInvoicePaid: false },
  actsSummary: [{ lineupLabel: 'Bespoke 4-piece' }],
};
const dependencies = row => ({ BoardModel: { findOne: () => ({ lean: async () => row }) },
  ActModel: { findOne: () => ({ select: () => ({ lean: async () => null }) }) },
});
test('actual event-sheet projection replaces incorrect legacy totals and original paid flags', async () => {
  const core = { bookingId: 'EXAMPLE', agent: 'Direct', balancePaid: true,
    totals: { fullAmount: 3255, chargedAmount: 563, balancePaid: true } };
  const result = await withConfirmedAllocation(core, dependencies(board));
  assert.equal(result.agent, 'Encore');
  assert.equal(result.totals.bookingTotal, 2615);
  assert.equal(result.totals.fullAmount, 3255);
  assert.equal(result.totals.addOnsPostBooking, 640);
  assert.equal(result.totals.remainingAmount, 640);
  assert.equal(result.totals.balancePaid, false);
  assert.equal(result.actsSummary[0].lineup.bandMembers.length, 5);
  assert.equal(result.actsSummary[0].lineup.hotMeal, 5);
  assert.equal(result.lineupSelected, 'Bespoke 4-piece');
  assert.equal(result.actsSummary[0].lineupLabel, 'Bespoke 4-piece + Saxophone (5 musicians)');
  const members = getLineupMembersForPdf(result, {});
  assert.equal(members.length, 5);
  assert.equal(members.at(-1).instrument, 'Saxophone');
  board.extrasPaid = true;
  const paid = await withConfirmedAllocation(core, dependencies(board));
  assert.equal(paid.totals.remainingAmount, 0);
  delete board.extrasPaid;
});
test('direct booking payment projection retains existing deposit treatment', async () => {
  const result = await withConfirmedAllocation({ bookingId: 'EXAMPLE' }, dependencies({
    ...board, agent: 'Direct', payments: { depositChargedAmount: 563 }, balanceAmountPence: 269200,
  }));
  assert.equal(result.totals.bookingTotal, 3255);
  assert.equal(result.totals.depositAmount, 563);
  assert.equal(result.totals.remainingAmount, 2692);
  assert.equal(result.paymentArrangement, undefined);
});
test('Encore intro copy never asks for original balance or claims deposit receipt', () => {
  for (const contactRole of ['direct_client', 'agent']) {
    const email = buildIntroEmail({ ...board, contactRole, clientEmail: 'example@example.test' });
    assert.match(email.text, /original booking is arranged through Encore/);
    assert.doesNotMatch(email.text, /invoice for the balance|sending over the deposit|receipt for the deposit|and balance due/);
    assert.doesNotMatch(email.html, /invoice for the balance|sending over the deposit/);
  }
});
