// New booking-board records default to Bamboo. Existing and explicitly chosen
// invoice companies retain their own legal entity and payment details.
export function bookingBoardInvoiceCompany(payload={},existing={}) {
  const value=payload.invoiceCompany||payload.accounting?.invoiceCompany||existing.invoiceCompany||existing.accounting?.invoiceCompany||'BMM';
  return String(value).trim().toUpperCase()==='BMM'?'BMM':'TSC';
}
