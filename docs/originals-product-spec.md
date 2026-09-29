# TSC Originals — Product and Technical Specification

> Current pilot status: private preview. Both the frontend routes and every `/api/originals` endpoint are restricted to Rhona's allowlisted account. The broader musician access described below remains the launch design, not the current access policy.

Status: approved product direction; contracts require specialist music-law review  
Phase: Phase 1 planning  
Last updated: 29 September 2026

## 1. Purpose

TSC Originals is a controlled collaborative-production workflow for authenticated musicians in The Supreme Collective database. It takes an original idea from a moderated listing through competitive stem rounds, owner selection, mixing, mastering, final credit confirmation, and an approved master.

Phase 1 ends at an approved master. Distribution, collection-society registration, content production, social strategy, sync pitching, and release management remain a manual Phase 2 process until the operational workflow is better understood.

## 2. Users and access

### 2.1 Eligible participants

- Any musician record with a valid TSC login may list, reserve, or contribute.
- No additional Originals approval is required.
- Suspended or rejected musician accounts cannot participate.
- An individual may hold reservations on multiple projects simultaneously.
- A musician may contribute multiple instruments or roles to the same project.

### 2.2 Roles

- **Project owner:** creates the listing, orders rounds, reviews submissions, selects material, and approves mixes and masters.
- **Contributor:** reserves an instrument/role and submits one to three takes.
- **Mix producer:** competes in the mix round after source material is locked.
- **Mastering engineer:** competes in the mastering round after a mix is selected.
- **TSC administrator:** moderates listings, sees legal identities and all retained files, resolves stalled projects, reopens rounds, selects stems, appoints producers, and completes a project where intervention is permitted.

## 3. Navigation and screens

### Musician sidebar

1. **List an Originals Project**
2. **Originals Projects**
3. **My Original Projects**

### Admin sidebar

4. **Moderate Originals Listings**

### Supporting screens

- Project detail and layered listening workspace
- Reservation and agreement flow
- Contributor submission workspace
- Owner review workspace
- Mix round workspace
- Mastering round workspace
- Final credits and splits confirmation
- Admin audit and intervention view

## 4. Listing an Originals project

### 4.1 Required fields

- Project title
- Description of intended feel, references, and desired final result
- At least one requested instrument or role
- Preferred sequential instrument/role order
- Genres
- Owner display choice: public profile or anonymous
- Declaration that the project is original and not a cover
- Signed/versioned owner agreement

### 4.2 Optional fields

- Initial WAV source stem
- MP3 demo
- Video demo (MP4/MOV) or approved external video link
- Tempo/BPM
- Time signature
- Key
- Click track
- Owner artistic/credit name
- Specific instruments eligible to create the foundation when no initial stem exists
- Private invitations to particular musicians

### 4.3 Covers

- Covers are not permitted in Phase 1.
- The owner must explicitly declare that uploaded material is original or appropriately controlled.
- Moderators may reject suspected covers or copied material.

### 4.4 Moderation

- New projects enter `pending_moderation`.
- Admin reviews metadata, source material, requested roles, declarations, and agreement version.
- Approval changes the project to `live` and opens the foundation or first role round.
- Rejection returns structured reasons and allows resubmission.
- Owner receives an approval/rejection email.
- Approval triggers matching email and WhatsApp notifications to relevant musicians.
- Initial moderation is feature-configurable so it can later be relaxed without redesigning the workflow.

## 5. Project workflow

### 5.1 Project states

`draft` → `pending_moderation` → `live` → `foundation_open` or `role_round_open` → `owner_review` → repeated role rounds → `arrangement_locked` → `mix_open` → `mix_review` → `master_open` → `master_review` → `credits_confirmation` → `approved_master`

Additional states:

- `changes_requested`
- `paused`
- `admin_intervention`
- `cancelled`
- `archived`

Every transition is recorded in an immutable audit event with actor, timestamp, reason, previous state, and new state.

### 5.2 Foundation with an initial stem

- The supplied source establishes the initial musical foundation.
- The owner sets the preferred order of subsequent instrument rounds.
- One instrument/role round runs at a time.

### 5.3 Foundation without an initial stem

- The owner selects one or more instruments eligible to establish the foundation, such as guitar or piano.
- There are three active foundation reservation slots in total.
- The competing reservations may be for different eligible instruments.
- The foundation round closes when three valid submissions arrive or seven days elapse, whichever occurs first.
- The owner selects the material that forms the foundation.
- If nothing is suitable, the owner may reopen the foundation, renotify the same categories, or change the eligible foundation instruments.

### 5.4 Sequential role rounds

- After the foundation is selected, rounds normally run one at a time in the owner's preferred order.
- The owner can reorder future rounds.
- Each instrument/role has up to three active/completed submission places.
- The round closes after three valid submissions or seven days, whichever is earlier.
- With fewer than three submissions, owner approval is still required.
- The owner may accept material, reopen the role, or move to another role.
- Once three completed submissions exist, new reservations are disabled until a submission is rejected or administratively withdrawn.

## 6. Reservations

- Base duration: exactly 24 hours from successful reservation.
- Slot acquisition must be atomic to prevent a fourth concurrent reservation.
- Expired reservations release automatically.
- The same musician may reserve again after expiry if a slot remains available.
- Private invitations do not consume a slot until accepted.
- Reservation requires acceptance of the current contributor agreement.
- Only a participant with an active reservation and current signed agreement receives controlled reference access.

### 6.1 Extensions

- Contributor may request an extension before expiry.
- Owner chooses 12 or 24 additional hours.
- Maximum: three approved extensions per reservation.
- Each extension requires a separate request and decision.
- If the owner does not decide before the current deadline, the reservation expires normally.
- Expiry notification explains that the musician may reserve again.

### 6.2 Countdown notifications

- Reservation confirmed
- 12 hours remaining
- 6 hours remaining
- 1 hour remaining
- Extension requested
- Extension approved/rejected
- Reservation expired/released

Phase 1 channels: email and WhatsApp.

## 7. Contributor access and submission

### 7.1 Reference access

- Contributors do not receive source WAV downloads.
- Active contributors receive expiring access to MP3 reference proxies and the browser listening workspace.
- Access expires when the reservation expires unless a completed submission or later role requires continued access.
- All file access and download attempts are logged.

### 7.2 Submission package

A contributor submits one to three takes. Three are recommended, not required:

1. Stripped-back
2. Medium
3. Embellished

For each take:

- Individual instrument WAV stem
- MP3 mixdown combining the take with the authorised reference material
- Optional notes
- Optional BPM, key, time signature, and alignment/start-offset metadata

The submission may also include a click track or click-map information.

### 7.3 Songwriting declaration

Each submitted role must choose:

- `master_only`: performance/master contribution only; no songwriting claim, or
- `songwriting_claim`: contributor believes the role contains original compositional authorship and claims the role's automatic writing unit.

The contributor describes the claimed contribution (for example melody, lyrics, topline, harmony, or compositional structure). The interface displays the provisional effect of the claim.

This declaration and the automatic fallback rules must be actively acknowledged. Contract language remains subject to music-law review and must not assert that a checkbox overrides statutory authorship or performer rights.

## 8. Layered listening and selection workspace

### 8.1 Phase 1 player

- Synchronized layered waveform playback
- Play/pause/seek
- Solo/mute
- Per-track volume
- Master volume
- Click-track toggle
- Take A/B comparison
- Time-coded owner comments
- Non-destructive time-range selection
- Full-take selection
- Clear display of submission, role, contributor credit alias, and current decision
- MP3 proxy playback; WAV originals remain private

### 8.2 Selection rules

- Owner selects either a complete take or one or more selected time ranges.
- Original files are never destructively trimmed.
- Selection stores timestamps and notes against the immutable source asset.
- Multiple ranges or takes from the same contributor for the same accepted role equal one royalty share.
- Accepted roles from different contributors, even for the same instrument, each receive a separate share.
- A musician with accepted guitar and bass receives two shares.

### 8.3 Rejection and reinstatement

- Rejected material is hidden from the owner and ordinary participants.
- TSC retains originals and metadata for audit/dispute purposes.
- Rejected contributor retains ownership of rejected recording material.
- Owner is notified that rejected material may not be reused or distributed.
- Contributor receives a neutral rejection message and may be contacted if the decision changes.
- Owner or authorised mix producer may request reinstatement.
- Reinstatement is recorded and restores appropriate visibility/rights review.

## 9. Owner response and TSC intervention

- Owner has seven days to complete each required review/approval.
- Reminder schedule is recorded and sent before intervention.
- At expiry, project enters `admin_intervention`.
- TSC may select stems, reopen rounds, appoint producers, and progress the track to an approved master.
- Existing earned royalty allocations remain intact.
- Every intervention requires an audit reason.

## 10. Mix and master rounds

### 10.1 Mix

- Begins after arrangement/source selections are locked.
- Up to three mix producers reserve 24-hour slots under the same extension rules.
- Authorised mixers sign the producer agreement.
- Mixers may download required WAV source files through expiring, logged URLs.
- Mixers may request access to rejected material; access requires recorded TSC/owner authorisation and restores applicable contributor rights review.
- Owner/TSC selects a mix or selected revision.

### 10.2 Mastering

- Begins after a mix is selected.
- Up to three mastering engineers reserve and submit under the same time rules.
- Mastering engineers sign the producer/mastering agreement.
- Owner/TSC selects the approved master.

## 11. Anonymity, identity, and credits

- Owner and each contributor independently choose public or anonymous presentation.
- Anonymous status persists throughout Phase 1.
- Anonymous participants choose an artistic/credit name.
- TSC retains verified legal identity privately.
- Owners, contributors, and other participants cannot access an anonymous participant's legal identity.
- Phase 2 introductions or live-performance opportunities require explicit permission before contact details or legal identity are shared.
- Credits use the public profile name or chosen artistic/credit name.

## 12. Economics and rights records

### 12.1 Master income

After contractually permitted direct costs:

- TSC: 20%
- Project owner: 20%
- Accepted contributor-role/stem pool: 40%, divided equally per accepted role/stem
- Selected mix producer: 10%
- Selected mastering engineer: 10%

One person may earn multiple role shares. Selected ranges from multiple takes within one role remain one share.

### 12.2 Songwriting — project with owner source material

- Owner source stem creates the initial writing unit.
- Each accepted creative role/stem adds one potential equal writing unit.
- An accepted role claiming songwriting receives its calculated unit.
- Unclaimed contributor units accrue to the original owner/songwriter.
- Percentages recalculate provisionally as accepted roles change.

Example: owner foundation + guitar + bass + drums = four units. Only guitar claims writing: guitar 25%, owner 75%.

### 12.3 Songwriting — project without source material

- If at least one accepted creative role claims songwriting, 100% is divided equally among accepted roles that claimed.
- If no accepted role claims songwriting, 100% is divided equally among all accepted foundation roles.
- The project lister receives no automatic writing share unless they supply an accepted creative role.
- The agreement explicitly discloses this automatic fallback before submission.

### 12.4 Precision

- Stored percentages use fixed decimal precision.
- A deterministic remainder rule assigns the final fractional remainder so every split totals exactly 100%.
- Displayed rounding must not alter stored entitlements.

### 12.5 Final split confirmation

- Arrangement lock generates a versioned master split and composition split.
- All affected parties confirm before the master is approved for Phase 2.
- Changes create a new version; previous versions remain immutable.
- PPL/statutory performer allocations remain separately tracked and are not overridden by the contractual master split.

## 13. Agreements

All agreements are versioned, timestamped, linked to identity and project, and retained with the exact accepted text/hash.

### Owner listing agreement

- Master and songwriting rules
- Timely-response obligations
- TSC intervention rights after seven days
- Original-material declaration and cover prohibition
- No misuse of contributed material
- Anonymity/credit choices
- Audit retention and dispute disclosure
- Phase 2 handled separately

### Contributor agreement

- Confidentiality
- Restricted reference access
- No reuse, DJ use, redistribution, training use, or use on other records
- Rejection and partial-use possibility
- Master share rules
- Songwriting claim and fallback rules
- Credit and anonymity choice
- Retention for disputes

### Mix/master agreement

- Confidentiality and controlled downloads
- No external use or distribution
- 10% selected-role master allocation
- Treatment of rejected material requests
- Audit retention
- Deliverable standards

All contract text is placeholder content until approved by a qualified UK music solicitor.

## 14. Profiles and statistics

Track event-sourced metrics, including:

- Projects listed
- Reservations accepted/expired
- Submissions completed
- Roles accepted
- Released/approved-master collaborations
- Mixes selected
- Masters selected
- Public collaborators
- Response/reliability rate (admin/internal initially)

Anonymous collaborations contribute to counts but do not expose counterpart identity. Public profile statistics must distinguish activity from selected/released credits.

## 15. Notifications

Phase 1 sends email and WhatsApp for:

- Listing submitted/approved/rejected
- Matching project live
- Private invitation
- Watched instrument/role opened
- Reservation lifecycle and countdown
- Extension lifecycle
- Submission received
- Owner review reminders
- Stem accepted/rejected/reinstated
- Round opened/closed/reopened
- Mix/master opportunities and decisions
- Split confirmation required/completed
- TSC intervention
- Approved master

Every notification uses an idempotency key and delivery log to prevent duplicate sends.

## 16. Storage and media security

Recommended architecture: private S3-compatible object storage (AWS S3 or Cloudflare R2) with separate originals and proxy prefixes.

- WAV originals are private and never exposed through permanent public URLs.
- Browser playback uses generated MP3 proxies.
- Access uses short-lived signed URLs issued only after server-side authorisation.
- Authorisation checks project role, reservation state, agreement version, and asset classification.
- Every access grant is logged.
- Malware/type validation, duration inspection, checksums, and server-derived metadata are required.
- File extension alone is never trusted.
- Assets are soft-deleted/hidden operationally and retained according to the dispute-retention policy.
- Storage provider configuration is environment-based; credentials never enter client code.

Initial configurable limits:

- WAV stem: 500 MB each
- MP3 mixdown/demo: 100 MB each
- Video demo: 1 GB
- Maximum three takes per role submission

Limits require validation against actual storage/transcoding cost before production launch.

## 17. Core data model

Use separate collections to avoid an unbounded project document and to preserve immutable records.

### `originalProjects`

Identity, owner, anonymity, listing fields, desired roles/order, foundation configuration, moderation, workflow state, deadlines, selected mix/master, agreement references, timestamps.

### `originalRounds`

Project, type (`foundation`, `instrument`, `mix`, `master`), requested/eligible roles, sequence, state, opened/closed timestamps, seven-day deadline, slot limits, outcome.

### `originalReservations`

Project, round, musician, role, status, start/expiry, extension requests/decisions, agreement acceptance, invitation reference. Enforce slot limits atomically.

### `originalSubmissions`

Project, round, reservation, contributor, public credit identity, role, songwriting declaration/details, submission state, owner/admin decision, accepted ranges, notes, timestamps.

### `originalAssets`

Owner entity, project/submission, classification, private storage key, proxy key, checksum, MIME, size, duration, audio metadata, visibility, retention status.

### `originalAgreements`

Agreement type/version/hash, accepted identity, project/submission context, displayed credit name, signature/acknowledgement evidence, timestamp, IP/user-agent where lawful and appropriate.

### `originalSplitVersions`

Project, version, master allocations, composition allocations, calculation inputs, confirmation states, superseded link, immutable timestamp.

### `originalEvents`

Append-only project audit events and metric source events.

### `originalNotifications`

Channel, recipient, event, idempotency key, template version, delivery state, provider reference, attempts.

## 18. API surface

All mutation routes require authentication, role checks, validation, idempotency where applicable, and audit events.

### Listings/projects

- `POST /api/originals/projects`
- `PATCH /api/originals/projects/:id`
- `POST /api/originals/projects/:id/submit-for-moderation`
- `GET /api/originals/projects`
- `GET /api/originals/projects/:id`
- `GET /api/originals/mine`

### Moderation

- `GET /api/originals/moderation`
- `POST /api/originals/projects/:id/approve`
- `POST /api/originals/projects/:id/request-changes`
- `POST /api/originals/projects/:id/reject`

### Rounds and invitations

- `POST /api/originals/projects/:id/rounds`
- `PATCH /api/originals/rounds/:roundId/order`
- `POST /api/originals/rounds/:roundId/reopen`
- `POST /api/originals/projects/:id/invitations`
- `POST /api/originals/invitations/:id/respond`
- `POST /api/originals/projects/:id/watch-role`

### Reservations

- `POST /api/originals/rounds/:roundId/reservations`
- `POST /api/originals/reservations/:id/request-extension`
- `POST /api/originals/reservations/:id/decide-extension`
- `POST /api/originals/reservations/:id/release`

### Assets and submissions

- `POST /api/originals/assets/upload-intent`
- `POST /api/originals/assets/:id/complete`
- `GET /api/originals/assets/:id/access`
- `POST /api/originals/reservations/:id/submissions`
- `POST /api/originals/submissions/:id/decision`
- `POST /api/originals/submissions/:id/reinstate`
- `POST /api/originals/submissions/:id/comments`

### Mix/master and splits

- `POST /api/originals/projects/:id/lock-arrangement`
- `POST /api/originals/projects/:id/generate-splits`
- `POST /api/originals/splits/:id/confirm`
- `POST /api/originals/projects/:id/approve-master`

### Admin

- `POST /api/originals/projects/:id/intervene`
- `GET /api/originals/projects/:id/audit`
- `GET /api/originals/projects/:id/retained-assets`

## 19. Scheduled jobs

- Expire reservations safely and atomically.
- Send 12/6/1-hour reminders exactly once.
- Close rounds at three completed submissions or seven days.
- Send owner review reminders.
- Move overdue reviews into admin intervention after seven days.
- Notify role watchers when their role opens.
- Retry failed notifications with bounded attempts.

Cron handlers must be idempotent, lock work atomically, and never grant a fourth slot.

## 20. Security and privacy requirements

- Default-deny file access.
- Never expose private storage keys or permanent URLs.
- Server-side authorisation on every asset request.
- Admin-only access to legal identity, rejected assets, and audit material.
- No contributor can enumerate other participants' private submissions.
- Anonymous identity must not leak through filenames, metadata, email templates, URLs, logs returned to clients, or downloadable tags.
- Strip or replace identifying media metadata when generating proxies.
- Rate-limit reservations, invitations, comments, asset grants, and signing endpoints.
- Record agreement and decision evidence.
- Provide a defined dispute hold that prevents retained evidence deletion.
- Conduct privacy, data-retention, and music-law reviews before production.

## 21. Phase plan

### Phase 1A — Foundation

- Final product specification
- Legal placeholder agreement versions
- Storage proof of concept
- Core project, round, agreement, event, and notification schemas
- Auth/role policy
- Feature flag disabled by default

### Phase 1B — Listings and moderation

- List-project form
- Optional initial media uploads
- Admin moderation queue
- Approved project list/detail
- Matching notifications
- My Original Projects

### Phase 1C — Reservations and submissions

- Atomic three-slot reservation workflow
- 24-hour expiry and extension requests
- Controlled MP3 reference access
- One-to-three-take submissions
- Songwriting declarations
- Role watches and private invitations

### Phase 1D — Review workspace

- Synchronized proxy player
- Solo/mute/volume/click
- Time comments and non-destructive ranges
- Accept/reject/reinstate
- Sequential rounds and owner deadlines
- TSC intervention

### Phase 1E — Mix, master, and credits

- Mix competition
- Master competition
- Controlled WAV access
- Automatic master/composition split calculation
- Versioned confirmation
- Approved master handoff

### Phase 1F — Hardening and pilot

- Concurrency and expiry tests
- Asset authorisation tests
- Anonymity leak review
- Notification/idempotency tests
- Audit/dispute workflow test
- Small invited pilot
- Moderation and operational review

### Phase 2 — Release management

- Distribution
- PRS/MCPS/PPL registration assistance
- Artwork and metadata
- Social/content planning
- Videographer workflows
- Sync pitching
- Royalty ingestion, statements, and payouts
- Public showcase/archive

## 22. Phase 1 acceptance criteria

- Only authenticated eligible musicians can participate.
- Admin can moderate listings before publication.
- Projects with and without source stems follow the correct foundation workflow.
- No round can exceed three concurrent/completed submission places.
- Reservation expiry and up to three approved extensions behave deterministically.
- Unauthorised users cannot access private media.
- Owners can review synchronized proxies and select full takes or ranges.
- Rejected assets disappear operationally but remain in the admin audit record.
- Sequential contributor, mix, and master rounds can reach an approved master.
- Master and composition splits total exactly 100% and are reproducible from recorded inputs.
- Anonymous identities do not leak outside authorised admin views.
- Email and WhatsApp notifications are idempotent and auditable.
- Every material decision and state transition has an audit event.

## 23. Pre-production gates

The feature must remain disabled for general users until:

1. Owner, contributor, and producer agreements receive specialist legal approval.
2. Storage and transcoding costs are validated.
3. Privacy/retention policy is approved.
4. Anonymity and asset-access penetration tests pass.
5. Reservation concurrency tests pass.
6. A small moderated pilot completes successfully.
