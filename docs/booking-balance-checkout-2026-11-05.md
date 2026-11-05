# Direct booking balance checkout and invoice correction

For direct TSC bookings, the public event sheet's Pay Balance button opens Stripe Checkout. External agency bookings retain the PDF invoice route. A legacy website booking with its original Stripe Checkout ID is recognised even if the agent field is missing. Explicit external agency sources take precedence over a stale default Direct agent. Invoice company and booking source are separate: this does not change historical BMM accounting or reissue a contract under TSC.

## Invoice amounts

For booking 261128-MEISSNER-66844, the contracted total is £2,972, received deposit £980.76 and remaining balance £1,991.24. Its supplier/management accounting allocation already totals the balance (£1,270 + £721.24).

A balance-only invoice now shows £1,991.24 with no deposit line. A full-fee invoice deducts the deposit once. An allocation that reconciles with neither the full fee nor the outstanding balance falls back to the contracted total without displaying an invented supplier/management allocation. Separate extras invoices retain their own total. Separate positive extras and explicit negative manual adjustments remain included. Long invoice references fit above the issue date.

Already downloaded or emailed PDFs remain unchanged. Newly generated invoices use the correction.

## Payment handling

- The balance is calculated on the server from full and charged totals in integer pence. Query parameters cannot set the price. Missing payment totals fail closed.
- Existing paid flags and confirmed bank settlements are respected. Open Stripe sessions are retrieved and checked for booking, amount and currency before reuse. A superseded open session is expired; existing separate Stripe invoices are not duplicated.
- Checkout creation uses an idempotency key and does not accept promotion codes against an agreed balance.
- Both existing signed Checkout webhook handlers route balance payments through the shared fulfilment service. The return page also retrieves and verifies the session with Stripe; the balancePaid query parameter is not proof of payment.
- The conditional payment update requires the expected unpaid state, financial totals, currency and session ID. Retries do not add the payment twice and also repair the Booking Board mirror. Deposit payment/session IDs and historical accounting allocations are preserved; separate balance payment audit fields record the new receipt.
- Failure messages do not expose provider credentials. Neither a provider failure nor an unverified success URL marks the booking paid.

This follows [Stripe's Checkout fulfilment guidance](https://docs.stripe.com/checkout/fulfillment.md?ui=full-page): verified payment status, webhook handling, idempotent fulfilment and a return-page verification path.

## Validation and release

- Focused backend tests cover checkout prices/reuse/expiry, failed providers, paid/manual settlements, payment verification and duplicate delivery. Rendered PDF text tests cover balance-only, full-fee, inconsistent allocation and extras-only invoices.
- PDF previews were rendered and visually inspected, including long extras invoice references.
- The actual event-sheet component was exercised in a headless browser: direct Stripe navigation, agency PDF navigation, failed checkout, verified/pending/invalid return sessions, mobile layout, existing DJ totals and two-vocalist lineup regression cases.
- Stripe sandbox verification created an unpaid test-mode Checkout Session for 199124 GBP pence, retrieved it and expired it. No live checkout, charge, email or database write was made during that check.
- Frontend production build passes. Existing event-sheet lint findings remain unchanged; the booking-source helper has no lint findings.

These code changes are local and need backend and public frontend deployment. The locally configured live Stripe key previously returned `api_key_expired`; sandbox credentials work. Check the production environment has a valid key for the booking's recorded invoice company and the correct signed `checkout.session.completed` webhook configuration before live use. No credentials were changed. Live Checkout has not been verified. Existing signed webhook URLs are retained.
