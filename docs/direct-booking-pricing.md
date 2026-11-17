# Direct website pricing

Approved 17 November 2026: deduct £50 for lineups with a normal London customer guide below £2,500; deduct £100 at £2,500 or above. The normal guide is the exact master G supplier rate multiplied by 1.33 and rounded up to whole pounds. Use the same fixed lineup saving for every county, once per quoted lineup; extras and travel additions are not discounted separately. County supplier fees already include travel.

`utils/supplierPricing.js` is mirrored in the public frontend. `supplierQuote` drives new website calculations, `minimumCustomerPrice` drives cards, the master sync cache and the live Google Merchant feed. Supplier values and marketplace pricing stay unchanged. Already captured booking/payment amounts are not recalculated by this policy. A missing London reference cannot be assigned a tier; repair the reviewed source mapping first.

Google feed: `/api/merchant/acts.tsv`, no cache, generated from current public act data at fetch time. Existing Merchant Center scheduled fetch continues to consume this URL; do not create a static CSV replacement or add another markup/discount in Merchant Center.
