# Originals reservation agreements

## What was already stored

`docs/originals-product-spec.md` sections 6, 7.3 and 13 require current contributor acceptance when reserving, explicit songwriting declarations, and retained identity-linked/versioned agreement evidence. Sections 10 and 13 separately require producer and mastering agreements. The existing admin owner agreement page implements a provisional owner listing agreement. There was no corresponding contributor/producer agreement page or acceptance check in either reservation endpoint.

The specification explicitly marks **all contract text as placeholder content pending approval by a qualified UK music solicitor**. The reservation terms added here are provisional pilot wording assembled from that stored framework and the existing owner agreement; they are not a recovered, solicitor-approved final contract. Specialist review remains required before public launch. Statutory authorship and performer rights are not waived by the checkbox; see [IPO guidance on performers’ rights](https://www.gov.uk/government/publications/performers-rights/performers-rights) and [copyright ownership](https://www.gov.uk/guidance/ownership-of-copyright-works).

## Current flow

Both current-round and advance-role reservation buttons open the same in-page review dialog. The server supplies the contributor, mix-producer or mastering-engineer terms as appropriate. Version 0.2 removes the participant-facing review-status/version banner at the user’s request. The internal researched-draft status remains documented; this does not represent solicitor approval. The displayed clauses and exact electronic-signature acknowledgement are included in the accepted text/hash. See [the detailed review](originals-agreement-review-2026-11-04.md) for remaining commercial decisions and code-policy mismatches.

The participant must enter their full name and actively tick consent; neither is prefilled as consent. Cancel/Close/Escape creates no reservation and starts no clock. Version conflicts clear consent and require reloading the current wording.

The backend validates explicit consent, the current version/hash and the exact displayed acknowledgement, then saves a new `originalagreementacceptance` document with the server's exact text, SHA-256 hash, version, agreement type, full-name acknowledgement, account ID, project ID, role and timestamp. Evidence fields are immutable through the model. Legal names are not returned in workspace data or substituted for public artistic credits. The reservation stores the acceptance ID. A rejected reservation attempt may leave a truthful standalone acceptance record, but no seat or countdown.

The shared seat allocator verifies that acceptance belongs to the same musician, project, role and contract type, with current exact wording, before creating a timed reservation. An advance reservation carries its existing acceptance into activation; the worker never manufactures fresh consent. Missing or outdated acceptance leaves the advance place waiting, flags a review action in the workspace and queues one review email per place/round/text hash. The email explains that the round is open and the recording countdown has not started. Delivery rechecks participation, round and reservation state; released or already-renewed places do not receive stale review emails.

Renewal records a new acceptance and updates only the waiting place's reference. Earlier evidence is retained. If the matching round is open, normal activation can then start the recording reservation and send the ordinary deadline email.

## Confirmed entity and no-deductions policy

Version 0.3 identifies The Supreme Collective Ltd (company 16883956), records TSC’s intended collection/accounting role for royalties it is authorised to collect, and funds TSC/project costs from TSC’s 20% instead of deducting them from the pool. The recommended March/September payment cycle remains a proposal in the review notes, not an accepted deadline. This change does not implement a royalty ledger or payout service.

## Scope and deployment

Deploy frontend and backend together. Create the new acceptance collection/indexes alongside the advance-reservation indexes. Existing timed reservations are **not retrospectively signed or backfilled** by this change; any migration requiring renewed acceptance for existing timed reservations needs an explicit participant acknowledgement. This change gates new reservation creation and advance activation. It does not replace the existing asset-access policy with all the additional reference-proxy restrictions described in the product specification.

This is a private-pilot implementation. The existing owner agreement implementation is unchanged; no claim is made that its older acceptance records have acquired text/hash evidence. No live contracts have been signed and no production data, uploads or emails were created during development validation.

## Validation

Tests cover missing/unchecked consent, empty names, stale versions, forged hashes, identity/project/role/type mismatches, exact evidence, no early clocks, advance activation/recovery, retained renewal history and review-email delivery. Browser checks exercise the real workspace components at mobile width: current and advance reservations, initially unchecked consent, full-name requirement, cancellation, expired wording/reload, matching mix terms and successful request payloads. Existing Originals membership, chat, royalties, notifications and workflow tests remain part of regression validation.

## Listening mix for each stem

Contributor version 0.4 changes only the deliverables paragraph: each submitted stem or alternative take has its own listening mix with the authorised project track/approved stems where available. Other submitted alternatives must be left out of that mix. An optional effects reference belongs to its paired stem and counts towards the three-stem limit. Mix/master terms remain version 0.3. Earlier acceptance evidence remains intact; waiting contributors with outdated terms must review the current wording before activation. Existing timed reservations are not retrospectively signed. See [the per-stem listening workflow](originals-per-stem-listening-mixes.md).


## Browser review and stems-only contributions

Contributor version 0.6 makes uploaded listening mixes optional in every recording round. New stems are reviewed with the current project references in the browser, with a per-file alignment acknowledgement. Browser rough mixes are private recording/review references and do not become approved release masters. Production agreements remain version 0.3. Earlier acceptance evidence and active reservations are retained; the existing renewal rules apply when current terms are required. See [the browser mixing workflow](originals-browser-rough-mixes.md).
