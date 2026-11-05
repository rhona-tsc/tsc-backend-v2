# Originals recording plan and workspace

Project roles can have an optional `recordingOrder` (unique whole numbers 1–30).
The existing `order` field remains the role list position. Legacy projects have
no inferred preference and require no migration. Blank preferences clear a
number; partially numbered plans put numbered roles before unnumbered roles.

Creation and draft updates validate preferences through `normaliseRequestedRoles`.
After creation the owner or an authorised TSC manager can save the plan through:

```
POST /projects/:id/roles
{
  "action": "set_order",
  "recordingOrder": [
    { "name": "Click", "recordingOrder": 1 },
    { "name": "Drums", "recordingOrder": 2 },
    { "name": "Vocal", "recordingOrder": null }
  ]
}
```

Supply every current role exactly once. The endpoint applies the existing
planning/recording stage restrictions, compares the saved project version and
stage, and records `project_recording_order_updated` in the audit history.
Adding/removing other roles preserves preferences. Saving a plan never changes
a live round or an accepted recording.

For a project with an initial stem, the first numbered role opens first.
Projects needing a foundation retain their foundation eligibility rules. After
acceptance, the workspace suggests the next incomplete numbered role; the
manager explicitly confirms it or selects another instrument. Mixing/mastering
retain their existing stage checks. No preference is invented for older roles.

The manager-only workspace `recordingPlan` contains the next-stage suggestion
and a `reviewDueAt`: seven days after the latest submission in the current
round, while that round has a pending submission. A replacement resets its
submission time and therefore the review window. Missing legacy dates do not
produce an arbitrary deadline. The notice updates as time passes and exposes
the existing TSC review flow; it never chooses or approves audio automatically,
and it does not send an additional escalation email.

The workspace groups project details and current-round controls beside the
royalty split on desktop, stacking on small screens. Recording progress shows
approved roles, then current roles, then future roles in preferred order.
Approved stems stay mounted and visible. Chat is a fixed bottom-right widget,
expanded initially, preserving drafts, attachments and recordings when
minimised. Hidden chat and chat covered by a modal do not acknowledge messages.
Recording activity remains visible on the minimised header.

Validation: focused plan/controller/deadline and progress-order tests; existing
Originals and musician privacy suites; admin checks/build; browser fixture
checks for responsive layout, approved playback, chat drafts/unread state,
plan editing, next-round confirmation/override and participant restrictions.
No production data, emails or deployments are used in these checks.
