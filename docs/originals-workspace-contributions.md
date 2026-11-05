# Contribution workflow and project recommendations

Current recording and review behaviour is described in [Browser rough mixes and stem alignment review](originals-browser-rough-mixes.md). Stems no longer require separately uploaded listening mixes; the older pairing workflow below remains supported for existing material.

## Recording and submitting

The project guidance and embedded guide/sample come before the role progress cards and file uploads. The combined “Listen to the project” player retains its existing meaning: approved stems played together. Role cards use aggregate statuses calculated on the backend, without exposing other musicians' pending recordings or identities.

Uploads store files privately. Submitting a take sends a chosen separate part and listening mix for review. Clear labels explain both files. Uploaded files are selected automatically when there is no existing selection for that file type. The displayed expiry belongs to the reservation, not the uploaded file.

Master royalties remain part of the existing accepted-contribution allocation. They are shown ticked; the separate songwriting checkbox adds a claim, using the unchanged `songwriting_claim` API value. It does not replace the master share or guarantee a songwriting percentage.

An optional `wetStemAssetId` can accompany each take. It must be a distinct `take_stem` owned by the musician and uploaded against the same reservation. It is a reference effects version of the same performance; it is not automatically layered over its clean version. Owner review exposes it in a separate player. Rejection, replacement and retraction hide it with the other take files, and the existing participation gate protects its secure download.

Section links open collapsed panels, scroll to them and move keyboard focus. Extensions follow the submission form. The recording tips explain that musicians use their own recording software and align exports from a common session start; they link to [Ableton's export guidance](https://help.ableton.com/hc/en-us/articles/360000843404-Importing-and-exporting-stems) and [Logic's audio export guide](https://support.apple.com/en-ca/guide/logicpro/lgcpb27f70f9/10.7/mac/11.6.1).

## Recommendations

- Current project viewers can search musicians by name via a project-protected endpoint. Results contain a display name and instruments, without email addresses or phone numbers.
- Someone not found can be entered with a full name, email and phone. Details are saved in an `originalreferral` record, without creating or modifying that person's musician account. They register themselves if interested.
- Recommendations are unique per project/email/role, with a daily sender limit. Filled roles reject new recommendations. They do not reserve a slot or guarantee selection.
- Emails name the referrer, project and role, and contain a 30-day secret invitation link. Only its SHA-256 hash is stored. A recipient must both possess that link and sign in using the email address it was sent to before claiming it. Forwarding the URL to another account does not grant access.
- Claimed referrals grant access to this project, without adding anyone to the global private-preview allowlist. The project board is restricted to their claimed projects. Moderator, creation and other project routes retain their existing protection.
- Existing participation rules still remove rejected/unselected musicians. Claiming a referral cannot restore a lost role. Passive invitees also lose workspace access when their recommended role is filled; anyone already participating in another accepted/current role retains access.
- Email sends occur after the API response. The existing minute-by-minute notification job also retries recommendation emails with a bounded retry count. No real emails were sent during development.

Deploy frontend and backend together, including the new referral index and take schema field. Verify SMTP delivery, new-account registration followed by invitation claim, and the existing live Cloudinary upload/download checks before release. Recording and referral browser tests use local mock services; email tests inject a fake sender.
