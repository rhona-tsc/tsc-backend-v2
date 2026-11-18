# Guided recorded enquiry pilot — 18 November 2026

The default voice mode is `guided`. Explicit `voicemail` and `conversation` modes remain available for compatibility. Public routing and advertising are not changed.

The test number asks, in order: full name, phone, email with spelling, event date including year, venue/location including county/postcode, style/performer count/instruments (and optional budget or named bands), then additional requests including songs/DJ add-ons. It introduces itself once at successful start and discloses recording/transcription. Each spoken answer has its own private recording and `#` advances; silence detection is disabled. Each question and the overall pilot retain bounded time budgets.

The final keypad question records explicit permissions: 1 both email and phone, 2 email only, 3 phone only, 4 neither. No response is not permission. Two invalid/empty responses end with an incomplete draft. The pilot closing says answers are saved for review; it does not promise customer quotes, checked availability or bookings.

Signed, account-bound callbacks use fixed question IDs. Callback/action races, retries and process restarts reuse the same intake; they cannot advance twice or replace another answer. A hangup keeps completed answers. The worker checks the existing provider call (never creates a call), recovers an unassigned final recording only when its association is unambiguous, saves audio to the existing private GridFS bucket before provider cleanup, and transcribes each answer. Playback is available by answer only to the same authorised management roles as before. Provider media URLs and file IDs are not exposed to browsers.

Literal section answers are saved before optional model interpretation. If interpretation is unavailable, recognizable literal contact/date/location/size/budget fields and the full labelled transcript still become an unconfirmed draft, with a visible review warning. No missing year, consent or contact is invented. Using caller ID as the callback requires an explicit request in the phone answer. Audio remains available if transcription itself fails. A finished or interrupted call sends one test-labelled management summary to the fixed office address through the existing claimed notification mechanism. Suggested bands are for staff review only.

There is no customer email/WhatsApp, musician availability dispatch, calendar write, booking or advertising conversion path in this flow. Contact permissions refer only to this enquiry, not marketing subscriptions. Every enquiry remains a draft and all details require review.

The user approved two further test calls on 18 November within the original £10 envelope. The persistent meter is preserved (10 calls used at implementation); the cap is now 12. No automated phone call should be placed to verify deployment. Use GET health checks and local signed webhook fixtures; the user makes the physical test calls.
