# Release validation and database rollout — 7 September 2026

**Earlier database rollout complete; private-media cutover and application release held.** [PR #76](https://github.com/EdoiseO/student-market-of-toronto/pull/76) is open and requires independent approval. The production application remains at `6a98cb1866a587c656309356d753f0b2386ddfe1`. The new gateway migration `20260907202430` is applied only in isolated staging. This checkpoint supersedes the deployment status in the [6 September report](release-check-2026-09-06.md).

## Current demo scope checkpoint — 7 September 2026

The user authorized proceeding with the demo release. Custom SMTP, a branded sender, and general student-inbox delivery are **DELIBERATELY DEFERRED**. These are prerequisites before real student onboarding, not blockers for this limited demo and not verified capabilities. Keep the existing restricted built-in sender and approved owner-inbox staging fixture. No custom email system, paid service, domain purchase, or new provider choice is needed for this scope.

The English/French recovery request page states the delivery limit without showing a personal address. Its conditional success copy does not confirm account existence. The PKCE/session isolation, five-minute provider deadline, school hook and existing confirmation policy are unchanged. The original scope decision did not waive any security or review gate; the subsequent verification below records what has actually passed.

## Demo candidate verification checkpoint

The candidate routes every private attachment through an authenticated, uncached application endpoint. Each GET, HEAD and range request checks the viewer's current database permissions before a server-only download. All five attachment consumers use the endpoint; private images bypass optimization, while public listing photos retain the shared gallery and optimizer. The database migration adds operation-scoped Storage restrictions and a resumable, hash-verified relocation ledger. See [the delivery boundary](private-message-media.md) and [relocation procedure](message-media-relocation.md).

| Check | Evidence and limit |
| --- | --- |
| Native security integration | `838649a`: 381/381 passed with PostgreSQL required, zero skips/failures. The subsequent HTTP verifier adds nine passing offline tests; current-head full-suite/CI must still be recorded. |
| Builds and dependencies | Runtime `f1d1814` passed the local webpack production build and an actual Vercel Turbopack preview build. Full lint at `f27d8c7` passed; dependency audit reported zero vulnerabilities. Later commits through that revision change SQL, scripts, tests and documentation, not the built application runtime. |
| Fixed-session hosted private media | 35/35 checks passed against isolated HTTPS staging, including unchanged cookies after committed demotion, repeated exact URLs, participant controls, HEAD/ranges/conditional requests and optimizer rejection. Original moderator metadata was restored exactly. This does not retire legacy Storage URLs. |
| Hosted large image/video | A 6 MiB PNG and four-second H.264 video completed the normal reserved/idempotent send. Six gateway checks passed: HEAD/full GET, exact byte hashes and video prefix/suffix ranges. Every response had browser/CDN no-store headers; no reusable validator was emitted. An initial local upload transport failure was resolved without changing application limits. |
| Retained-token Realtime | Four phases passed: moderator positive control, demotion on an already-open channel, demotion after reconnect using the original JWT, and restored-role positive control. Participant delivery and reactions remained functional; foreign notification signals and legacy notification-table events were absent during bounded five-second observation windows. This is not a proof of indefinite event absence. |
| Real delivered HTTPS recovery | 18/18 checks passed using the approved owner-inbox staging fixture and actual Supabase email. Verified exact HTTPS redirect, host-only Secure/HttpOnly/SameSite=Lax recovery cookie, foreign-browser and cross-origin denial without consuming the legitimate flow, password replacement, same-account auth-cookie expiration, old-password rejection, old refresh-token revocation, and replay rejection. This supplements the earlier delivered flow preserving a different signed-in account. It does not prove student-inbox delivery. |
| Historical deployment protection | Anonymous requests to the inspected old immutable URLs and team/branch aliases returned Vercel SSO redirects or 401, rather than media. Project protection is `all_except_custom_domains`. The public canonical alias must point only to the new application after cutover. This protection is necessary because historical server code can still sign with service credentials. |
| Legacy cache retirement | In progress. The worker stopped safely before activation/deletion when Storage served conflicting cache directives despite persisted no-store metadata. The participant gateway continued returning correct bytes with no-store headers. Provider headers or a cache-busting query do not prove old-cache revocation. Exact retained Storage and optimizer URLs must be replayed after retirement. |
| Browser/device coverage | In progress in isolated browser sessions. Emulation must be distinguished from physical devices and assistive-technology testing. |
| GitHub approval and release | Required independent approval remains outstanding. New local commits must be pushed and current-head CI must pass before merge. No new production gateway migration, object relocation, application release or cache purge has been performed at this checkpoint. |

Staging read-back confirmed nine migration-history entries, including exact `20260907202430` source MD5 `1add7ce163f68d9e42b700d7add0b326`. Its advisors reported 16 INFO notices for deliberately inaccessible internal tables and eight existing WARN notices (seven authenticated definer boundaries plus disabled leaked-password protection), with no ERROR notices. Production still has 58 history entries and none for the new gateway migration. A read-only production inventory found 11 attachments and 11 corresponding private objects, with no unmatched rows or unreferenced private objects. Inventory must be refreshed at cutover.

Operational receipts are kept outside Git in the release workspace. They contain status, hashes and bounded assertions; credentials, recovery links, signed URLs, private inventories and account mappings remain in the separate private staging directory. The historical failed-cache receipts are retained below and have not been converted into passes.

## Coordinated demo cutover

1. Finish legacy Storage/optimizer retirement and browser checks in isolated staging. Fix any security failure; record unsupported hardware checks honestly. Obtain green current-head CI and the required independent GitHub approval.
2. Re-read production migration history and object inventory. Preserve the already-live demo migration timestamp, private registry and school-validation helper. Prepare the new production application before changing the public alias; do not release an application that depends on an absent resolver RPC.
3. Apply exact `20260907202430` with reviewed history/source guards and promptly switch the canonical alias to the verified gateway application. The brief compatibility interval must be planned: older client pages use Storage URLs and cannot be the fallback after the new restrictions.
4. Confirm historical immutable deployments and aliases remain inaccessible to ordinary visitors. A one-time cache purge alone does not prevent old service-role code from signing future attachments. Refresh and freeze the legacy inventory after the old public app is retired; account for in-flight old requests before declaring inventory complete.
5. Relocate the exact frozen attachments through the worker: copy, validate object identity/metadata and matching hashes, activate the mapping, verify participant delivery, delete the original through Storage, and finish the ledger. Preserve resumable state on failure. Never bulk-delete unrelated objects or rewrite immutable attachment records directly.
6. Purge the Vercel project CDN/image cache using the supported purge operation, then replay exact retained old Storage and optimizer URLs with their original query and Accept variants. Confirm no old bytes are returned; fresh-origin or token-expiry checks cannot substitute. Verify the public app's authenticated delivery, demotion denial, public listing images, video ranges and recovery pages.
7. Record the deployed commit, migration and alias read-backs, cache receipts and any limits. If a release check fails, contain access and fix forward; do not restore a build or policy that reintroduces signed private delivery. Keep the SMTP/student-inbox prerequisite visibly deferred until real student onboarding.

The remaining sections preserve earlier evidence and are historical where the checkpoint above supersedes them.

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
- Session-route regression revision `e034d01`: three focused tests passed for same-account cookie clearing, unrelated-account preservation, and rejected-password preservation through the actual completion route, cookie adapter and SDK. Targeted lint passed. The hosted same-account and actual HTTPS cases remain separate outstanding checks.
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

Remaining demo-release work:

1. Resolve and verify the private-media cache limitation, including existing assets and any promised revocation deadline.
2. Finish the hosted same-recovered-account cookie-clearing case with another approved email, plus actual HTTPS cookie behavior and remaining account-state cases. Do not replace delivered PKCE verification with an incompatible admin-generated implicit link.
3. Complete actual Realtime delivery and the previously documented authenticated device/accessibility checks. The authority harness does not cover those flows.
4. Obtain green checks on the current head and the required independent PR approval. Merge without bypassing review protections, deploy the application, and verify the canonical production release and live workflows.

**Deliberately deferred until before real student onboarding:** configure custom SMTP and a suitable sender, then verify delivery to a controlled institutional inbox. The built-in sender permits organization-member inboxes only; owner-inbox success is not proof of general student delivery. Any future signup-confirmation change is a separate product decision. This deferred work is excluded from the current demo gates above. [Supabase SMTP guidance](https://supabase.com/docs/guides/auth/auth-smtp)

Rollout is already authorized once these checks pass. Keep restrictive database boundaries in place while completing the application release. Retain private staging fixtures for the pending recovery test, then remove them through trusted cleanup workflows and record disposal. Do not publish passwords, tokens, signed URLs, inbox mappings, or private backups with this report.
