# Advance reservations, release, and grouped stems

## Reserving future roles

Once a project is live, an authenticated eligible project viewer can hold an advance place for a requested instrument that is not in the current round. Each role has three places. A future place has no `roundId`, expiry, or recording countdown; it does not start the foundation round's seven-day clock.

Advance places live in `originalrolereservation`, separate from timed recording reservations. Unique partial indexes enforce one waiting place per musician/role and at most three numbered waiting places per role. The workspace exposes only the viewer's advance records to participants; role cards show aggregate place counts.

When the owner opens a matching round, waiting places activate into timed reservations in order. Their individual 24 hours start on activation. The normal seven-day round clock starts when the first timed reservation is created. A minute-by-minute worker recovers interrupted activation and queues/sends a recipient-specific round-open email with the deadline, project link and release instructions. Email failures retry without duplicating the recording reservation. Released, expired or no-longer-eligible reservations do not receive those emails. Previous rejection rules continue to block that role; a legitimate waiting place in another role can retain project membership.

## Deadline reminder monitoring

The workflow automation queues reservation reminders at 12, 6 and 1 hours before expiry. The minute-by-minute email worker now delivers those queued reminders. Each email includes the current UK deadline and a workspace link; uploading a file alone is distinguished from submitting it for review. Submitted, released, expired, cancelled, extended or previous-round reservations are checked again before delivery so stale reminders are cancelled. Failed email delivery retries up to five times using the existing notification lease and unique event key.

During monitoring, these reminder emails BCC `hello@thesupremecollective.co.uk`. Set `ORIGINALS_RESERVATION_REMINDER_BCC_ENABLED=false` in the backend environment to stop the monitoring copies while retaining musician reminders. An unset value defaults to monitoring enabled. The address is not added to CC or the message body, and is omitted from BCC when it is already the primary recipient. This setting does not copy chat notifications, invitations, round-open or closure emails.

Scheduling and delivery both require `ORIGINALS_AUTOMATION_ENABLED=true` and Originals to be enabled. The existing workflow automation switch also controls expiry and automatic round review transitions; this change does not enable it or alter the live environment. Deploy the backend and verify that setting before expecting deadline reminders or BCC copies. Validation uses a mocked email sender and sends no real email.

## Releasing places

Musicians can release their own waiting place, or their own unsubmitted timed reservation. Waiting releases free an advance place immediately; timed releases set `slotHeld=false`, free a numbered place and cancel queued round-open emails. They do not delete recordings or reset the round's deadline. Submitted contributions still use the existing review/retraction process.

Timed reservation allocation accounts for submitted recordings as well as active places and legacy unnumbered records. A partial unique index on `roundId` / `seatNumber` while `slotHeld=true` prevents simultaneous claims from overbooking a place. Expiry and rejection also free held places. A unique sparse `futureReservationId` prevents recovery from activating the same future place twice.

## Files and playback

Earlier submissions could group one to three separate stem files under one shared mixdown. New submissions now pair each stem/alternative take with its own listening mix; see [the current per-stem listening workflow](originals-per-stem-listening-mixes.md). The legacy grouped format is still supported for existing records. `stemAssetIds` groups the stems under one selected take; legacy `stemAssetId` remains the primary stem for backwards compatibility. Optional effects references count towards the three-file limit and remain alternatives, rather than automatically doubling the approved parts. A group is still one contribution for royalty allocation.

Ownership, reservation and file-kind checks apply to all grouped files. Whole-take approval includes all of that take's grouped stems. Selected time windows apply to every stem in the approved group. Replacement, rejection and retraction hide all of the grouped files together. Legacy alternative takes are not automatically merged into the project player.

The files section opens audio/video in place with native controls, on demand. Original downloads remain available through a separately signed attachment URL ([Cloudinary access documentation](https://cloudinary.com/documentation/control_access_to_media)). Files are not transformed or replaced. A local stem mixer offers include checkboxes, a common transport, Solo, per-part volume, Select all, Deselect all and Reset. It remains a browser listening preview; it does not export a custom mixed backing track.

## Review and deployment

Deploy frontend/backend together and create the new indexes before enabling advance reservations. Legacy timed reservations remain valid without numbered seats. Check the real database's index creation, email delivery and Cloudinary playback/downloads after deployment; development checks use in-memory model stubs, local synthetic audio and a fake email sender. No production records, emails or uploads were created by validation.

Tests cover three-place capacity including simultaneous attempts, submitted/legacy places, release and slot reuse, no early countdown, activation/recovery, recipient eligibility and cancelled email jobs, one-to-three grouped stems, legacy playback and partial approval windows. Browser checks cover actual audio playback, live include/mute/solo/volume controls and reset, embedded playback/download links, advance hold/release, grouped submission, and mobile layout.
