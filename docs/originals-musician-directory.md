# Originals musician browsing

The recommendation form and owner invitation lookup now use one browser component and one backend directory service. Names are optional: opening a Vocal recommendation lists matching vocalists immediately, with instrument and saved-profile-genre filters. Each page contains up to 25 people and has Previous/Next navigation, so the old 15/20-result limits no longer hide later matches. Sorting uses first name, surname and ID for stable pages.

Instrument matching reads `instrumentation.instrument` and legacy `instrument`/`instruments`; vocal matching also reads the declared `vocals.type` and excludes the “I don't sing” option from the vocalist-type match. Generic Keys includes piano/keyboards, generic Bass includes bass guitar/double bass, and generic Guitar excludes bass guitar. Other instrument choices match their saved labels. Genre filtering reads `vocals.genres`, the existing profile preference field, plus legacy top-level `genres`; it does not infer preferred genres from repertoire song titles. Options include actual saved custom instruments and genres.

Both results APIs return only ID, display name with surname initial, profile photo URL, instrument labels, genre labels and the public profile path. Email, phone, address and private admin records are not returned. Owner lookup can still search by email after project-manager authorisation. Participant recommendation lookup remains behind the existing project participation/referral checks. Photos use a 112px Cloudinary delivery limit for the 56px display; missing or broken photos show initials.

Profile links use `VITE_PUBLIC_SITE_URL` (default `https://thesupremecollective.co.uk`), a musician slug or ID fallback, and open a separate public profile tab so the workspace selection remains available. The admin's private musician record is not used as a participant profile link.

The profile editor now offers the existing genre checkboxes to instrumentalists as well as singers, using the same stored field and save path. Existing profile values are retained; no migration or inferred genre assignment is performed.

Owner invitation role selection is explicit. Selecting a different role, changing filters or paging clears the chosen musician to prevent inviting a stale, hidden result. Requests are cancelled when filters change or the lookup closes. The owner directory loads only when its invitation panel is opened.

Deploy the admin and backend together because the owner lookup response now shares the public-card shape used by recommendations. No production emails, invitations, referrals or profile updates were sent during validation. Tests use model stubs, generated musician fixtures and local synthetic audio; real database performance and production public-profile playback remain deployment checks.

Validation covers instrument/genre combinations, literal regex input, missing/invalid filters, pagination beyond the old cap, safe response fields, owner-only email lookup and permissions, existing/new recommendation paths, profile links with playable local audio, role-correct invitations, genre edits for non-singers and mobile layout. The existing Originals workflow, chat, membership, royalty, notification and agreement tests also pass.

## Recommendation emails

Recommendation emails now include the referrer's display name, project title, requested role and full project description, with line breaks preserved. A branded button uses the existing project-specific referral URL; sign-in and invitation claiming continue to use the recipient's email address. The message encourages recipients to follow the recommendation, ends with “Warmest wishes”, and uses the shared musician email footer with the signature GIF, social links and registered address. HTML and plain-text versions carry matching content. Personalised fields and the brief are HTML-escaped. The old project-only access sentence and reservation disclaimer are removed from the email; underlying permissions and reservation rules are unchanged.

Local checks cover the template, delivery/claim flow and desktop/mobile rendering, including long briefs and titles, with no real emails sent. Backend deployment is required for future recommendation emails to use this template; existing sent emails are unchanged.

## Private invitation test profile and cleanup

`privateTestProfile=true` removes a profile from ordinary Originals browse results, filter facets, other musician searches, public profile endpoints and automatic deputy suggestions. Only Rhona's authenticated hello@, rhona@ and rhonagdownie@gmail.com identities may see it in a manual lookup; an arbitrary admin or project owner cannot. Hidden IDs cannot bypass recommendation/invitation checks. Private test results do not link to a public profile. Existing profiles default to public, and normal profile updates cannot change this immutable field.

The requested cleanup was applied on 5 November 2026: nine matching musician profiles were removed after a verified, owner-readable-only Extended JSON backup was saved under `~/.codex/backups/tsc-musician-cleanup-*`. Both protected hello@/rhona@ profiles, genuine Rowan profiles, acts, bookings and historical references were preserved. No emails or Cloudinary media were deleted or sent.

The retained company-email Rowan profile has deliberately not yet been renamed: the backend privacy checks must be deployed first. After deployment, run `node scripts/cleanupTestMusicianProfiles.js --apply --activate-private-test` from the backend workspace to rename it Test, update both name representations and its slug, and mark it private in one transaction. The script creates another private backup before any change. Without `--apply` it only reports the plan; without `--activate-private-test` it leaves the retained profile unchanged. Repeated cleanup preserves an already renamed private Test profile. Deploy the admin photo component too, then verify lookup as Rhona and another account. Local tests use a fake email sender and synthetic images.
