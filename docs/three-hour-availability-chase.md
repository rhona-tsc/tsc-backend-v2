# Three-hour availability chase

The active availability worker now sends the first reminder three hours after
the original request was sent. It checks every five minutes, during 09:00–21:00
Europe/London. A reminder becoming due overnight waits until 09:00. The existing
second and final reminders remain 24 hours apart; booking-role reminders retain
their existing hourly worker and 24/48/72-hour rules.

The reminder reuses the exact request ID, original role, fee, act, date and
location, with the existing approved WhatsApp template. It does not create a new
availability request, application, allocation or booking. No SMS fallback is used.

Before sending, the worker requires an active matching enquiry-board row and
verified delivery of the exact original message to the same recipient. It skips
closed/contacted/converted enquiries, positive lead replies within the exact
enquiry/act/lineup/date, explicit replies, musician website messages, ambiguous or
declined calendar responses, expired/test requests and disabled roster members.

Each stage uses a database claim, followed by another reply/scope check. A
provider error, missing response SID or interrupted send retains the claim and
requires reconciliation before retry, preventing duplicate reminders after a
timeout or restart. The original request's message SID is preserved.

For a reply received outside WhatsApp/the website, set
`availabilityRemindersPausedAt` and `availabilityRemindersPausedReason` on the
exact Availability document. Do not manufacture a raw YES/NO reply. Existing
quote/application records must have their board status reconciled before rollout.

`TWILIO_AVAILABILITY_REMINDERS_ENABLED=false` disables this worker. Preview with
`runAvailabilityChasers({ dryRun: true })`; previews make no claims or sends.

Tests use injected in-memory models/provider functions and never message people.
