# Release validation and database rollout — 7 September 2026

**Database rollout complete; application release held.** [PR #76](https://github.com/EdoiseO/student-market-of-toronto/pull/76) is open and requires independent approval. The production application remains at `6a98cb1866a587c656309356d753f0b2386ddfe1`. This checkpoint supersedes the deployment status in the [6 September report](release-check-2026-09-06.md).

## Production changes verified

Guarded transactions applied the exact tracked source and original timestamps below. Native rehearsals verified preservation and failure behavior before execution. Read-only production checks then verified history, definitions, grants, policies, and publication membership.

| Version | Migration | Verified result |
| --- | --- | --- |
| `20260906144154` | Current moderation read authority | Legacy role helper/policies removed; current-role and standing boundaries installed; direct notification INSERT revoked |
| `20260906150000` | Browser-bound password recovery | Service-only intent table and reserve/claim functions installed; anonymous/authenticated access denied |
| `20260907180439` | Remove notifications from Realtime | Legacy notification table removed from the publication; four intended tables remain |
| `20260907190013` | Fix listing Storage upload phases | Authenticated preflight and trusted completion handled separately while preserving reservation, owner, MIME/size and retirement checks |

The already-live `20260906160016_registered_demo_account_emails.sql` was preserved. History grew from 54 to 58 entries, and the original 54 records, nine demo-registry entries, and school-validation helper matched their pre-rollout fingerprints. Private mappings/backups remain outside Git. Executed wrappers are frozen evidence, not scripts to replay against the advanced history.

Auth Site URL is now `https://student-market-of-toronto.vercel.app`; allowed redirects are its exact `/auth/callback` and `/reset-password?state=*` routes. The school hook remains enabled. Signup confirmation remains off, and the built-in SMTP sender is unchanged. No production account, password, listing, or message was edited by this rollout.

Production and staging advisors each reported 15 informational RLS-without-policy notices and eight warnings: seven existing authenticated definer RPC boundaries and disabled leaked-password protection. No ERROR-level notices were returned. This is a recorded residual state, not a claim that all warnings are resolved.

After the database rollout, public production GET checks for `/`, `/login`, `/forget-password`, and `/reset-password` each returned HTML with status 200. These were availability checks only; they did not authenticate a user or send email.

## Local and hosted evidence

- Runtime revision `37699ab`: **341/341 security tests** passed with PostgreSQL required, no skips or cancellations; production build passed. The listing Storage change includes preflight/completion, invalid metadata, ownership, retirement, migration-chain, and already-live demo-preservation regressions.
- Report review bindings and sanction return navigation were repaired in `2b2bb74`; focused tests and explicit undefined-binding lint passed. Recovery copy in English/French now explains the provider's five-minute deadline (`bda8664`).
- Harness revision `6910212`: corrected `message_reactions` lookup to use its real composite-key column; syntax, lint, and three no-network guard tests passed. It did not change any allowed/denied expectation.
- Earlier revision `18c310a` passed both push/PR security matrices on Ubuntu 24.04 and macOS 14. Those historical results do not certify a newer head; inspect current PR checks before merge.
- A free isolated Supabase project was built from the production schema without copying production records. Catalog comparison covered 1,545 objects; four formatting differences were separately reviewed for semantic equivalence. Synthetic fixtures used normal authenticated listing, message, report and Storage workflows.
- Hosted moderator/participant positive controls, unrelated staff Data API denials, bounded report context, and unchanged-token Data API denials after committed demotion passed. A separate diagnostic also checked role-to-staff and forced-name transitions, forbidden notification INSERT, role restoration, and continued participant access.
- Ordinary staging signup rejected a non-school domain and accepted an allowed school domain. The positive fixture was deleted and absence verified. Confirmation is off, so this proves domain eligibility, not school mailbox ownership.

## Failed Storage gate

The official harness failed when an unchanged authenticated Storage URL returned `200` after moderator demotion. The response reported `CF-Cache-Status: HIT` and `Cache-Control: public, max-age=3600`. Data API access was denied, as were a separate fresh-query download and creation of a new signed URL. A diagnostic continued other assertions but deliberately retained a failed release result.

This is a new HTTP delivery of cached private media, not merely an image already displayed in the browser. Previously issued signed URLs also remained usable during the test. No verified upper bound on cached delivery was established; token expiry alone is insufficient. Supabase documents separate signed-token and response-cache lifetimes. [Smart CDN documentation](https://supabase.com/docs/guides/storage/cdn/smart-cdn)

The four applied migrations improve current database/origin authorization but do not resolve this delivery limitation. A separate plan covers enforced no-store headers for new private uploads, actual hosted same-URL verification, and a controlled strategy for existing immutable objects and caches. No fifth migration, production object rewrite, or cache purge has been performed. Do not weaken the strict harness assertion to obtain a pass.

## Recovery delivery evidence and remaining work

Two real recovery emails were delivered to an approved owner inbox attached only to a temporary staging account. The fixture has no staff role or demo-registry entry and creates no production Gmail exception. The application was tested at the allowlisted `http://localhost:3220` origin.

The first flow rejected a foreign browser without changing its ordinary session. Its legitimate submission later failed because the provider PKCE flow had expired five minutes after the email request. The second flow completed within that deadline and verified password replacement, old-password rejection, revocation of the prior refresh session, replay rejection, a cleaned address bar, and preservation of a different signed-in account.

Remaining release work:

1. Resolve and verify the private-media cache limitation, including existing assets and any promised revocation deadline.
2. Finish the hosted same-recovered-account cookie-clearing case with another approved email, plus actual HTTPS cookie behavior and remaining account-state cases. Do not replace delivered PKCE verification with an incompatible admin-generated implicit link.
3. Configure production custom SMTP and verify delivery to a controlled student inbox. The built-in sender permits organization-member inboxes only; owner-inbox success is not proof of general student delivery. Decide any signup confirmation policy deliberately. [Supabase SMTP guidance](https://supabase.com/docs/guides/auth/auth-smtp)
4. Complete actual Realtime delivery and the previously documented authenticated device/accessibility checks. The authority harness does not cover those flows.
5. Obtain green checks on the current head and the required independent PR approval. Merge without bypassing review protections, deploy the application, and verify the canonical production release and live workflows.

Rollout is already authorized once these checks pass. Keep restrictive database boundaries in place while completing the application release. Retain private staging fixtures for the pending recovery test, then remove them through trusted cleanup workflows and record disposal. Do not publish passwords, tokens, signed URLs, inbox mappings, or private backups with this report.
