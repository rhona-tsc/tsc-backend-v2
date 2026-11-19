import test from 'node:test';import assert from 'node:assert/strict';
import {newBalanceDueISO,balanceDueISO,balanceReminderISO,BALANCE_PAYMENT_POLICY} from '../utils/balanceDueDate.js';
const row={eventDateISO:'2027-04-17',bookingDateISO:'2026-11-19',agent:'Direct',paymentTermsVersion:BALANCE_PAYMENT_POLICY};
test('four week Thursday and five week reminder',()=>{assert.equal(newBalanceDueISO(row),'2027-03-18');assert.equal(balanceReminderISO(row),'2027-03-11');});
test('direct late bookings payable upfront, agent midpoint',()=>{assert.equal(newBalanceDueISO({...row,bookingDateISO:'2027-04-10'}),'2027-04-10');assert.equal(newBalanceDueISO({...row,agent:'Entertainment Nation',bookingDateISO:'2027-04-10'}),'2027-04-13');});
test('month threshold and non-backdated reminder',()=>{const r={...row,bookingDateISO:'2027-03-20'};assert.equal(newBalanceDueISO(r),'2027-03-20');assert.equal(balanceReminderISO(r),'2027-03-20');});
test('existing explicit dates and Encore untouched',()=>{assert.equal(balanceDueISO({...row,invoiceDueDateISO:'2027-04-08'}),'2027-04-08');assert.equal(newBalanceDueISO({...row,agent:'Encore'}),'');});
test('Christmas closure moves deadline earlier',()=>{assert.equal(newBalanceDueISO({...row,eventDateISO:'2027-01-23'}),'2026-12-23');});
