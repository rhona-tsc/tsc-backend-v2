// Client links already shared through Monday remain authoritative for migrated bookings.
export function externalClientLink(row, kind) {
  const value = String(row?.importMetadata?.[kind === 'invoice' ? 'clientInvoiceUrl' : 'clientEventSheetUrl'] || '').trim();
  if (!value) return '';
  try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password ? url.href : ''; }
  catch { return ''; }
}
export function clientEventSheetUrl(row, base = 'https://thesupremecollective.co.uk') {
  return externalClientLink(row, 'eventSheet') || (row?.bookingRef
    ? `${base.replace(/\/$/, '')}/event-sheet/${encodeURIComponent(row.bookingRef)}`
    : String(row?.eventSheetLink || '').trim());
}
export const clientAutomationReviewPending = row => row?.importMetadata?.clientAutomationReviewPending === true;
