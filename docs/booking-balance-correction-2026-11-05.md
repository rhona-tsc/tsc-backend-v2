# Meissner booking: balance and duplicate DJ correction

Booking `261128-MEISSNER-66844`, Gotta Be Garage, 28 November 2026.

The original 6 February booking contract includes the band-member DJ in its £2,972 total and states £980.76 deposit paid, £1,991.24 outstanding. A Stripe notification confirms the £980.76 deposit. The later £417 shown on the event sheet was the same contracted DJ service, not a new purchase. No balance-payment confirmation was found in the available records. The user explicitly authorised correcting the records; this is not a new verification of bank receipts. Stripe's locally configured API credential is expired. No payment, refund, invoice, receipt or client message was created.

## Live correction applied

`scripts/correctMeissnerBookingBalance.mjs` defaults to read-only. Its explicit `--apply` mode updates only this booking and its exact linked board row, using a transaction and current-value assertions. It checks that totals and recorded receipts have not changed before writing. A private audit copy of the prior financial fields and exact patches is saved under `~/.codex/booking-corrections/`.

The core booking and board row now have balance-paid flags cleared. The core outstanding amount is 199124 pence. Contract/updated total remains £2,972, deposit and recorded charge remain £980.76, and later add-ons are explicitly zero. The board's zero gross value is corrected to £2,972, with the same deposit mirrored into its payment fields. Original selected extras, files, contract, accounting allocation, event details and payment identifiers are retained. Invoice/deadline fields and the FreeAgent invoice are not changed.

## Software changes awaiting deployment

The core Booking schema did not declare `totals`. A hydrated Mongoose document retained it in its raw object while direct `booking.totals` access returned undefined. Board update code could therefore read its default zero `amount`, calculate zero outstanding and mark the booking paid. `BookingTotalsSchema` now exposes and persists the existing totals, retains unknown legacy total fields and does not create absent values with zero defaults.

Board edits preserve existing totals during partial updates, cannot infer payment from a zero/missing price, and preserve an existing manual/bank settlement when financial amounts have not changed. Their top-level and nested balance fields stay aligned. New checkouts retain their original contracted total so later changes can be distinguished.

The event-sheet payment helper uses recorded contract/current totals and explicitly recorded later add-ons. `actsSummary.selectedExtras` and ambiguous `extrasTotal` do not establish a later purchase. Explicit zero later add-ons remain zero; an increased current total against a recorded original produces the actual difference once. A paid deposit alone is not treated as a full settlement. Explicit balance receipts and full payments remain supported.

Deploy the frontend and backend changes together. The live record correction does not deploy code; the currently hosted frontend can still display the duplicated DJ line until its new build is deployed.

## Validation

Backend regression tests use actual hydrated Mongoose booking documents and stub only persistence: legacy/new totals, tracked nested updates, missing/zero totals, partial updates, later price changes and previously settled bank/full payments. Related booking import, board, lineup and automation checks also pass.

Frontend tests cover the exact £2,972/£980.76/£1,991.24 case, explicit zero, separate/inclusive later add-ons, paid deposits versus full settlement, explicit partial balances and rounding. A headless browser renders the real event sheet and checks all money rows, payable versus settled buttons, mobile layout and browser errors. The frontend build passes; the edited page's existing lint diagnostics are unchanged and the new helper is lint-clean.
