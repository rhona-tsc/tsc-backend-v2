import { finalDetailsDueISO, previousWorkingDayISO } from './finalDetailsDueDate.js';
export const BALANCE_PAYMENT_POLICY = 'four-week-thursday-v1';
const iso = value => value instanceof Date ? value.toISOString().slice(0,10) : String(value || '').match(/^\d{4}-\d{2}-\d{2}/)?.[0] || '';
const shift = (value, days) => {const d=new Date(`${value}T12:00:00Z`);d.setUTCDate(d.getUTCDate()+days);return d.toISOString().slice(0,10);};
export const isDirectPaymentSource = source => /^(direct|tsc|tsc direct|the supreme collective|bmm|bamboo music management|banffy music management)$/i.test(String(source || 'Direct').trim());
export const isExternallySettledSource = source => /^(encore|wedding jam)$/i.test(String(source || '').trim());
export function newBalanceDueISO(row = {}) {
 const event=iso(row.eventDateISO || row.eventDate || row.date);if(!event)return '';
 const booked=iso(row.bookingDateISO || row.bookingDate || row.createdAt) || iso(new Date());
 if(isExternallySettledSource(row.agent || row.source))return '';
 const standard=new Date(`${shift(event,-28)}T12:00:00Z`);
 while(standard.getUTCDay()!==4)standard.setUTCDate(standard.getUTCDate()-1);
 const due=previousWorkingDayISO(iso(standard));
 const days=Math.round((new Date(`${event}T12:00:00Z`)-new Date(`${booked}T12:00:00Z`))/86400000);
 if(days<=28 && isDirectPaymentSource(row.agent || row.source))return booked;
 if(booked>=due){
  if(days<=0)return booked;
  const midpoint=previousWorkingDayISO(shift(booked,Math.floor(days/2)));
  return midpoint<booked?booked:midpoint;
 }
 return due;
}
export function balanceDueISO(row = {}) {
 const explicit=iso(row.invoiceDueDateISO || row.balanceDueAt);
 if(explicit)return explicit;
 return row.paymentTermsVersion===BALANCE_PAYMENT_POLICY ? newBalanceDueISO(row) : finalDetailsDueISO({...row,eventDateISO:iso(row.eventDateISO || row.eventDate || row.date),bookingDateISO:iso(row.bookingDateISO || row.bookingDate || row.createdAt)});
}
export function balanceReminderISO(row={}) {
 const due=balanceDueISO(row);if(!due)return '';
 const booked=iso(row.bookingDateISO || row.bookingDate || row.createdAt);
 const planned=shift(due,-7);
 return booked && planned<booked ? booked : planned;
}
