# Originals project chat

The workspace chat supports text, up to five attachments per message, and voice notes recorded directly in the browser. Stop a recording to preview it, then send or delete it. Files upload only on Send. Chat polls every five seconds while open and visible; closing it stops polling and microphone capture.

## Delivery and privacy

- The existing Originals private-preview gate applies to chat routes.
- Attachments must belong to the sender, be active, and belong to this project. Other participants can access them only after they are linked to a posted message.
- Chat files never count as accepted stems or starting material. Existing accepted-stem and reference access rules are retained.
- Sender labels use first name and surname initial, or the existing anonymous credit preference.
- A client message identifier and a partial unique database index protect retries. Saved messages remain successful when notification or audit follow-up fails. Follow-up failures are logged on the backend.
- The latest 500 messages are returned in chronological order. The existing credit, reservation, and review flows are independent of chat polling.

## Uploads and deployment verification

Chat files are limited to 10 MB each, within the Free plan's raw-file limit. Documents and images use authenticated raw storage; audio/video use authenticated video storage. Originals are retained. Access uses the existing five-minute signed-download mechanism. See [Cloudinary limits](https://cloudinary.com/pricing/compare-plans), [upload parameters](https://cloudinary.com/documentation/upload_parameters), and [access control](https://cloudinary.com/documentation/control_access_to_media).

Deploy the backend and frontend together, and ensure the new message index has been created. Validate uploads and downloads against the actual Cloudinary account before release: local tests mock Cloudinary storage. If PDF delivery is blocked on the Free account, check the product environment's **Allow delivery of PDF and ZIP files** security setting ([Cloudinary documentation](https://cloudinary.com/documentation/image_delivery_options)). No account settings were changed by this work.

Voice recording requires browser microphone permission and HTTPS (localhost also works). Runtime format selection supports WebM/Opus and MP4 where available, following [MediaRecorder documentation](https://developer.mozilla.org/en-US/docs/Web/API/MediaRecorder).

## Validation performed

- Backend chat tests cover saved-message follow-up failures, retries and concurrent duplicate handling, input validation, attachment ownership, anonymous names, unsent-file privacy, authenticated storage and signed access, and chronological message polling.
- Frontend tests cover attachment limits and recording formats/timers. Targeted lint and production build pass.
- Browser checks use the real browser recorder with a synthetic microphone and mocked server/storage: text sending, failed drafts/retry identifiers, incoming polling, attachment-only sends, recording/preview/delete/send, denied microphone access, cleanup on close, and phone-sized layout.

## Participant access and chat email notifications

Project owners and participating musicians receive an email for new chat messages, excluding the sender. Recipients are accepted contributors, current submissions awaiting review, and valid current reservations. Prospective viewers and invitees who have not joined are not chat email recipients.

A round in review has not decided its winners yet. A rejection ends that role's access immediately. Once the project advances, unselected submissions and stale submitted reservations from the closed round no longer provide access or notification eligibility. Anyone with another accepted or active role retains project access, but cannot reserve a rejected role again without a fresh owner invitation. Owners and TSC managers retain management access.

The participation rule is enforced on the backend for project workspaces, chat reads/sends, secure files, uploads, reservations, submissions, issues and credit actions. Removed participants are also filtered from the project board. Open chats detect removal on their next refresh; the rest of an open workspace checks access every 15 seconds and when the tab becomes visible. Previously issued five-minute file URLs expire on their original schedule; the backend refuses new links after removal.

New messages carry a notification outbox marker. The backend queues recipient-specific email records, responds to the chat, then attempts delivery. A separate minute-by-minute job recovers missing queue records and retries failed delivery after five minutes, up to five attempts. It does not depend on enabling workflow-state automation. Notification eligibility is checked again immediately before sending, so queued chat alerts to someone who has since lost their place are cancelled. Emails contain a project link rather than private message content. Existing WhatsApp-only notification records are not converted into retrospective emails.

`ORIGINALS_CHAT_EMAIL_ENABLED=false` disables chat email delivery; it defaults to enabled and also respects `ORIGINALS_ENABLED`. The current private-preview allowlist remains in force. Email delivery is tested with an injected fake sender; no real emails were sent during development. Production SMTP delivery still needs verification after deployment. Backend tests include actual HTTP requests proving removed participants cannot bypass the checks using old project/file/workflow URLs.
