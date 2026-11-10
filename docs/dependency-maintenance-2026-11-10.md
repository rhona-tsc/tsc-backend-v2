# Dependency maintenance — 10 November 2026

## Changes

- Upgrade OpenAI 4.96.2 to 6.49.0, which removes the installed vulnerable optional Zod 3.24.3 peer. Existing Chat Completions calls, gpt-4o-mini default, prompts, retries, timeout and privacy checks remain unchanged. Zod 4.6.7 remains only under the browser dependency.
- Update the locked follow-redirects dependency from 1.16.1 to 1.16.3 for Axios and Chromium. No broad dependency upgrade or forced audit fix.
- `npm audit` and `npm audit --omit=dev`: zero vulnerabilities after installation.

Advisories: https://github.com/advisories/GHSA-mrwp-f3q8-3g9p and https://github.com/advisories/GHSA-mrhx-c7xc-m3w5 . SDK compatibility checked against https://developers.openai.com/api/docs/libraries and the documented Chat Completions interface.

## Validation

14 focused tests pass across dependency compatibility, the real biography/tagline service with mocked transport and database, deputy visibility, manager access, route access and history visibility. No paid AI request or real application/payment mutation is needed.

The full suite is not green: cancellation message date formatting and Encore fee import assertions fail. The same three assertion failures reproduce with the unchanged HEAD source and original lockfile in an isolated installation (20 pass, 3 fail in both comparisons). Bespoke editing and lineup tests pass when given a synthetic Stripe key; the initial full run intentionally disabled live credentials and encountered initialization failures there. The full suite was stopped after an unrelated client automation test stalled. These are not treated as passing checks or repaired in this dependency release.

## Release convention and rollback

Backend main is deployed manually in Render; a Git push alone is not evidence of a live release. Verify the deployed commit, successful startup and public deputy endpoints after deployment. Roll back to the previous successful Render deployment if startup or smoke checks fail. This release has no database migration.

## Public HTTP/www redirect investigation

The public frontend already has explicit HTTP/www-to-HTTPS-apex rules before application routing. Fresh live requests still show Netlify issuing HTTP www → HTTPS www before applying HTTPS www → HTTPS apex. The path and query string survive both hops. Netlify's domain redirect documentation distinguishes protocol rules from force_ssl handling: https://docs.netlify.com/manage/routing/redirects/redirect-options/ .

The authenticated Netlify domain-management page currently displays a connection error, preventing verification of hosting-level settings. No DNS, certificate, Force HTTPS or security setting has been changed. Do not add duplicate redirect rules or claim this remaining hop is fixed. Inspect the platform settings once dashboard access works; any proposal that disables HTTPS enforcement needs explicit review before application.
