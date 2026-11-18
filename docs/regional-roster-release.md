# Regional deputy pools and allocation exclusions

Regular Deputies now supports per-person event regions and independent priority within each regional pool. Existing deputies with no regions keep their previous unrestricted behavior. Restricting a musician requires a known event region, county or postcode; unknown locations require review rather than selecting from the wrong pool.

Allocation exclusions are private act policy records, separate from public act data. They apply to candidate availability, direct offers, manual confirmations, late WhatsApp acceptances, bulk original/deputy selection and deputy escalation. Actual selected singers replace original singers in the exclusion check. This lets Renes play with replacement singers when none of the excluded people is selected, while preventing a later singer assignment from introducing an excluded pairing.

## Deployment and reviewed roster application

1. Deploy backend and admin changes together. Verify `GET /api/roster-capabilities` reports version 1 with both capabilities enabled.
2. Keep the reviewed roster JSON outside Git; it contains private staffing instructions. The prepared Soul Allegiance input is stored in the operator's private Codex release directory.
3. From the backend directory, run `node scripts/applyRegionalRoster.mjs /absolute/private/roster.json`. This previews only; it does not mutate records or contact anyone.
4. Inspect performer counts, pending profile matches and regional assignments. Soul Allegiance should retain the two solo entries, restore keys to the 6/7/8-piece lineups and add a separate optional 9-piece with trombone. No person without a confirmed profile is turned into an automatic outreach contact.
5. Apply with the same command plus `--apply` only after the runtime capability check succeeds. `ROSTER_BACKEND_URL` can select a staging backend when the database environment also points to staging.
6. The script creates a private BSON-preserving EJSON backup before changing data, uses one transaction with stale-read checks for act and policy, then verifies the saved lineups. Rerunning does not duplicate roles or the ninth lineup.
7. Check South and North pools in Regular Deputies and preview allocations for a southern and northern county. Confirm Renes is blocked with Emma, Kedesha or Ione/Miça and that an eligible keys deputy is selected. Check a booking with replacement singers too.

Pending identities remain visible in Regular Deputies and are not contacted. Adding missing profiles, changing fees and sending invitations remain separate actions.

## Validation

Run the regional-roster tests plus existing deputy identity, pricing and enquiry availability tests. The admin build and a local fixture preview verify region filtering and the policy display. Existing historical bookings are not rewritten by the roster migration.
