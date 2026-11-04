# Originals reservation agreements

## What was already stored

`docs/originals-product-spec.md` sections 6, 7.3 and 13 require current contributor acceptance when reserving, explicit songwriting declarations, and retained identity-linked/versioned agreement evidence. Sections 10 and 13 separately require producer and mastering agreements. The existing admin owner agreement page implements a provisional owner listing agreement. There was no corresponding contributor/producer agreement page or acceptance check in either reservation endpoint.

The specification explicitly marks **all contract text as placeholder content pending approval by a qualified UK music solicitor**. The reservation terms added here are provisional pilot wording assembled from that stored framework and the existing owner agreement; they are not a recovered, solicitor-approved final contract. Specialist review remains required before public launch. Statutory authorship and performer rights are not waived by the checkbox; see [IPO guidance on performers’ rights](https://www.gov.uk/government/publications/performers-rights/performers-rights) and [copyright ownership](https://www.gov.uk/guidance/ownership-of-copyright-works).

## Current flow

Both current-round and advance-role reservation buttons open the same in-page review dialog. The server supplies the contributor, mix-producer or mastering-engineer terms as appropriate. The participant must enter their full name and actively tick consent; neither is prefilled as consent. Cancel/Close/Escape creates no reservation and starts no clock. Version conflicts clear consent and require reloading the current wording.

The backend validates explicit consent and the current version/hash, then saves a new `originalagreementacceptance` document with the server's exact text, SHA-256 hash, version, agreement type, full-name acknowledgement, account ID, project ID, role and timestamp. Evidence fields are immutable through the model. Legal names are not returned in workspace data or substituted for public artistic credits. The reservation stores the acceptance ID. A rejected reservation attempt may leave a truthful standalone acceptance record, but no seat or countdown.

The shared seat allocator verifies that acceptance belongs to the same musician, project, role and contract type, with current exact wording, before creating a timed reservation. An advance reservation carries its existing acceptance into activation; the worker never manufactures fresh consent. Missing or outdated acceptance leaves the advance place waiting, flags a review action in the workspace and queues one review email per place/round/text hash. The email explains that the round is open and the recording countdown has not started. Delivery rechecks participation, round and reservation state; released or already-renewed places do not receive stale review emails.

Renewal records a new acceptance and updates only the waiting place's reference. Earlier evidence is retained. If the matching round is open, normal activation can then start the recording reservation and send the ordinary deadline email.

## Scope and deployment

Deploy frontend and backend together. Create the new acceptance collection/indexes alongside the advance-reservation indexes. Existing timed reservations are **not retrospectively signed or backfilled** by this change; any migration requiring renewed acceptance for existing timed reservations needs an explicit participant acknowledgement. This change gates new reservation creation and advance activation. It does not replace the existing asset-access policy with all the additional reference-proxy restrictions described in the product specification.

This is a private-pilot implementation. The existing owner agreement implementation is unchanged; no claim is made that its older acceptance records have acquired text/hash evidence. No live contracts have been signed and no production data, uploads or emails were created during development validation.

## Validation

Tests cover missing/unchecked consent, empty names, stale versions, forged hashes, identity/project/role/type mismatches, exact evidence, no early clocks, advance activation/recovery, retained renewal history and review-email delivery. Browser checks exercise the real workspace components at mobile width: current and advance reservations, initially unchecked consent, full-name requirement, cancellation, expired wording/reload, matching mix terms and successful request payloads. Existing Originals membership, chat, royalties, notifications and workflow tests remain part of regression validation.
