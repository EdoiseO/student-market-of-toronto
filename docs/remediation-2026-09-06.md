# Student Market of Toronto — implementation and remediation handoff

Prepared 2026-09-06 (America/Toronto). Source implementation: `098ccae`, based on audit revision `9149b6469a8d171726de3042e5262f6028d37f59`.

The approved mobile moderation redesign, clickable listing photos, login experience, and three security remediations are implemented and committed locally. **Security verification outcome: blocked.** Focused tests demonstrated the intended security boundaries, but the final full-suite/build gates and real Supabase staging checks are not complete. This report does not declare the findings fixed in production.

The original checkout became read-only when this task's permissions changed. Work was preserved and completed in `/Users/edoise/Documents/Codex/2026-09-06/rev/work/implementation-checkout`, on `agent/redesign-message-media`. The original checkout contains overlapping uncommitted implementation work and stops at commit `5307888`. It has not been overwritten or synchronized to the completed branch. No push, production deployment, migration application, or Auth configuration change occurred.

## Product changes

The large mobile filter cards have been replaced with a compact search field, a filter button, and workflow-status chips. Secondary filters use the existing Radix sheet. Cancelling discards draft filters; applying updates the URL. Five queues share this layout: listings, reports, conversations, enforcement, and users. Rows wrap titles and metadata, retain filtered pagination, and distinguish loading, unavailable data, and empty results. The selected moderation tab scrolls into view. English and French copy is included.

Listing review separates the submission evidence, expandable context/history, and decision form. The real listing photo is a keyboard-accessible button that opens the existing `MessageMediaGallery`, reusing its full-screen view, zoom, image navigation, swipe behavior, and icons. Multiple images are available through a single compact preview; Escape restores focus to the opening thumbnail. Listing-report evidence also uses this component. No new image-generation or gallery dependency was introduced. The visual preview uses an existing public listing asset with illustrative content; it is not a live moderation record.

Report review keeps evidence and notes before decisions, with secondary context collapsed on mobile. Staff do not see controls for decisions they cannot perform. Back links and successful decisions preserve the originating queue's filters and selected record. Listing decisions retain the existing revision checks and retry operation IDs; a synchronous submission guard and error cleanup prevent duplicate submissions or a permanently busy form after a network error.

“Login successful. Redirecting...” has been replaced with a continuous signing-in/navigation state. Successful login proceeds directly to the destination. If navigation stalls, a Continue action retries navigation without resubmitting credentials. Invalid credentials and service failures have distinct, translated messages. This avoids a success toast appearing while the login form becomes usable again.

## Security boundary and implementation

### 1. Current moderation authority and private conversations — Medium

**Vulnerable path:** permissive RLS policies trusted old role claims in already-issued JWTs. Current staff and demoted moderators could retain broad access to unrelated private conversation content. A service-backed report loader could also bypass the caller's RLS boundary.

**Invariant:** elevated access must use the account's current role and standing at the database boundary. Ordinary users must retain their own/participant access. Staff report triage must not become unrestricted conversation browsing.

`20260906144154_current_moderation_read_authority.sql` replaces all 14 identified legacy policy dependencies with a private, actor-derived current-authority check. It reads the current Auth metadata through the existing role parser, respects Auth/application bans and forced-name restrictions, and fails closed when authority is unavailable. It preserves public, owner, and conversation-participant branches. Staff retain report/listing triage; broader private conversation, message, attachment, and reaction reads require current moderator/admin authority. Untrusted notification INSERT grants and obsolete write policies are removed while trusted notification producers remain.

A bounded report-context RPC derives the conversation from the report ID. It returns the reported message and at most two messages on each side, plus one primary listing image. The application validates the returned shape and bounded context; the report page uses its authenticated client for data, with no service-role read fallback. A full-conversation link appears only when the returned authority permits it.

The independent candidate reviewer found an additional validation-to-use gap in the existing service conversation RPC: `IF NOT (CASE ...)` did not deny a NULL role. A demotion after the page precheck could still reach the private message-page implementation. The migration replaces this with `(CASE ...) IS NOT TRUE`, retaining the existing service guard, role/action matrix, standing checks, and grants.

**Exploit/control evidence:** the native fixture demonstrated old claims reading unrelated rows before the migration, then denial with the same claims after demotion. Current staff lost broad reads while bounded report context remained available. The actual service message-page function returned fixture rows after a precheck/demotion before the NULL correction, then denied role-cleared, forced-name, and staff actors afterward. Current moderators/admins, ordinary participants, own/public bios, and trusted notification delivery remained valid. The final focused authorization run passed 20/20 checks with no skips before the permission change.

Files: the migration, `src/lib/admin-report-context.mjs`, report detail loader/UI, `tests/current-moderation-read-authority.test.mjs`, its SQL fixture, the staging harness and its guard tests, and `docs/security/moderation-authority-staging.md`.

**Remaining proof:** native request-claim fixtures do not validate actual Auth signatures, Data API, Storage HTTP, or Realtime delivery. A staging harness is ready, but no disposable Supabase branch was available and no platform run occurred. Current authorization uses each statement's database snapshot; it cannot retract an already executing read. Previously signed media URLs remain bearer capabilities until expiry.

### 2. Password-reset links installing an attacker's session — Low

**Vulnerable path:** attacker-controlled recovery URLs could be consumed as authentication material and switch the visiting browser into the attacker's account.

**Invariant:** visiting a URL must never install a recovery identity as the browser's ordinary session. Recovery must require an explicit action bound to the initiating browser, intended account, and recovery purpose.

The shared browser SDK disables automatic session detection from URLs. A same-origin recovery request creates a short-lived, rate-limited database intent bound to a hash of an HttpOnly browser secret, the intended email, and a PKCE recovery verifier. URL state/code are captured into controlled page memory and removed from the address bar. Reading the recovery context does not redeem it.

A deliberate POST with the new password and confirmation atomically consumes the intent. An isolated Supabase client exchanges the code, checks recovery purpose and actual Auth identity, updates the password, and attempts global session revocation. It never installs a recovery session in general browser cookies or local storage. Raw bearer fragments, token-hash alternatives, and ordinary-session recovery fallbacks are rejected. Another signed-in account is preserved; same-account browser state is cleared after a successful password update. Signup callback handling remains explicit and cannot act as a recovery fallback.

The proxy still refreshes expired ordinary sessions and propagates refreshed cookies consistently to the response and downstream request. Exact recovery routes bypass normal eligibility redirects so users can recover; unrelated routes retain account-standing enforcement.

**Exploit/control evidence:** focused tests exercise the installed Supabase SDK with a controlled transport, malicious recovery inputs, browser/account binding, single-use consumption, expiry/rate limits, and session preservation. The native intent-table test covers ACLs and concurrent consumption. The final unrestricted focused run passed 13/13. The later restricted run passed 12 application cases; native PostgreSQL setup was blocked by the host.

Files: `src/lib/password-recovery.mjs`, `src/app/api/auth/recovery/route.js`, reset/forgot-password pages, signup callback, login/register components, shared browser client, proxy, translated copy, `tests/password-recovery.test.mjs`, `20260906150000_browser_bound_password_recovery.sql`, and `docs/password-recovery.md`.

**Remaining proof:** real email delivery, redirect allowlist, recovery/signup email templates, cross-browser behavior, and hosted Auth behavior still need isolated staging validation. A provider email scanner may consume a provider token before it reaches the application; application GET handlers themselves do not redeem the recovery code. Cross-device recovery intentionally requests a fresh link in that browser. After cleaning the URL, refreshing requires reopening the unused email or requesting another link. Failed revocation is reported truthfully; access tokens already issued can remain valid until expiry.

### 3. Temporary PostgreSQL allowing unauthenticated localhost access — Low, tests only

**Vulnerable path:** one temporary test database accepted unauthenticated TCP connections from local processes. This was a test-harness exposure, not a production database configuration finding.

**Invariant:** fixture databases must be reachable only through their owned private socket with explicit connection parameters, without inherited environment settings selecting another server.

All 17 native fixture callers now use `tests/helpers/postgres-fixture.mjs`. Each fixture owns a mode-0700 directory, data directory, and Unix socket; PostgreSQL has no TCP listener and host rules reject TCP. Database/user/socket parameters are explicit, dangerous libpq environment state is sanitized, and effective connection identity is checked before scenario SQL. Commands have bounded lifetimes. Cleanup targets only the owned server, retries a fast shutdown with immediate shutdown when appropriate, and preserves private evidence when stopping cannot be confirmed.

**Exploit/control evidence:** isolation checks cover hostile libpq settings, concurrent fixtures, quoted paths, hanging clients/startup/shutdown, cancellation, and cleanup. Existing SQL security scenarios ran through the shared helper. Before restrictions changed, the 18 native scenario cases, 10 isolation cases, and fresh migration-chain check passed. The later full rerun could not initialize PostgreSQL because the sandbox denied shared memory. Linux/macOS CI execution remains pending.

Files: shared helper and README, `tests/postgres-fixture.test.mjs`, 17 migrated native test callers, and `.github/workflows/security-tests.yml`.

## Ordered validation gates

| Gate | Result | Evidence and limit |
|---|---|---|
| Diff/syntax | PASS | Final scoped commits and `git diff --check`; `npm run lint` exits 0. |
| Focused authorization exploit/control | PASS before restrictions | `node --test tests/current-moderation-read-authority.test.mjs tests/moderation-authority-staging.test.mjs`: 20/20; final committed files match tested source. |
| Focused recovery exploit/control | PASS before restrictions | Recovery/account-security focused tests: 13/13; installed SDK against controlled transport plus native intent tests. Hosted provider not exercised. |
| Native fixture isolation and controls | PASS before restrictions | 18 existing native scenario cases, 10 isolation cases, and full fresh migration chain. |
| Updated UI regressions | PASS | Six selected affected regression tests; two executable queue-return validation tests. |
| Responsive queue checks | PASS with limits | 40 combinations: five queues × 320/390/768/1440 CSS px × EN/FR, no document horizontal overflow. Component preview with synthetic fixtures, not production authorization. One cookie-switch hydration warning remains for a clean language-switch rerun. |
| Filter/photo interactions | PASS | Cancel/apply, keyboard containment/Escape, accessible close label, image open/zoom/reset/next, photo focus restore, browser Back. See browser notes. |
| Dependency audit | PASS at update time | `npm audit fix --ignore-scripts` changed compatible transitive versions: zero reported vulnerabilities, no force update. No final online re-audit after network restriction. |
| Final full security suite | BLOCKED, not green | `npm run test:security`: 267 pass, 29 fail, 0 skipped. All 29 fail during PostgreSQL `initdb` with `shmget ... Operation not permitted`, before scenario assertions. |
| Production build | BLOCKED, not green | Initial copied-checkout symlink issue was resolved by copying dependencies. Retried `npm run build` then failed fetching Geist and Geist Mono from Google Fonts because network access was unavailable. Fonts were not mocked or removed to manufacture a pass. |
| Hosted/CI release tests | NOT RUN | Actual retained signed JWTs over Data API/Storage, Realtime, Auth email delivery/templates, Linux/macOS CI, and final authenticated mobile/device/assistive-technology checks remain. |

An earlier integrated run reported 295/301 passing; its six failures were obsolete UI source-shape expectations after the shared-component redesign. Those expectations were updated and all six now pass. This historical run is not represented as a passing final suite. Counts differ in the restricted run because nested PostgreSQL cases cannot start when parent setup fails.

Validation logs and agent evidence are supplied in `outputs/implementation-validation/`. Original audit findings remain the audit record; they have not been overwritten with a premature fixed status.

## Commits and safe handoff

1. `b42df43` — update vulnerable transitive dependencies.
2. `5307888` — isolate PostgreSQL test fixtures and bound cleanup.
3. `6931c0e` — enforce current moderation authority for private reads.
4. `2dbd29b` — bind password recovery to explicit browser intent.
5. `098ccae` — streamline mobile queues and focused image review, including report-loader integration.
6. A documentation checkpoint follows these source commits; its exact hash is in the supplied bundle manifest.

The deliverable Git bundle preserves the commits and their common base; the accompanying full patch permits inspection. Neither includes `.env.local`, dependency folders, build output, or the visual fixture project. The completed implementation checkout is clean after the documentation commit.

**Do not blindly apply the patch or reset the original checkout.** Its dirty changes overlap these commits and may include subsequent user edits. After project write access is restored, inspect its status against the supplied original status/diffstat, preserve all dirty and untracked work, import the bundle into a review ref, compare the overlapping files against the completed branch, and reconcile deliberately. The isolated completed checkout can be reviewed now without touching the original.

## Remaining release procedure

1. Restore the project's normal build/test environment and reconcile the checkout safely. Rerun lint, full security suite, build, dependency audit, and whitespace checks at the exact final revision. Run native CI on Linux and macOS; do not relax isolation to make it pass.
2. Use an acknowledged disposable Supabase staging project. The current-authority harness explicitly rejects the production project. Apply both new migrations in timestamp order before running the new application. Confirm no unexpected legacy helper/policy dependencies remain; the migration intentionally aborts on unknown dependencies.
3. Exercise current admin/moderator, staff triage, ordinary participant, demoted actor with the exact retained signed token, bans, forced-name state, deleted account, Data API, fresh Storage signing, and Realtime behavior. Verify normal notification producers/recipient access and bounded report context. Clean up only manifest-owned synthetic IDs.
4. Configure staging Auth redirect allowlist and recovery/signup email templates exactly as documented. Test a real delivered link, ordinary signed-in account preservation, attacker-supplied raw/foreign-browser inputs, explicit submit, one-use replay, expiry, provider-scanner failure, password-change success, and session-revocation failure handling. Verify signup callback and expired ordinary session refresh remain correct.
5. Finish real authenticated mobile/light/dark/EN/FR QA, long content, empty/error/loading states, filter history, image zoom/swipe/keyboard, decision validation/retries, 200% zoom, and assistive technology. The preview does not establish production security behavior or all device accessibility.
6. After these gates and explicit rollout authorization, apply the two production migrations before publishing the application, apply the verified Auth settings, and check production behavior/read-back. Preserve the database security boundaries on rollback; do not restore permissive policies or automatic recovery-token ingestion to recover availability.

There is no production security benefit from local commits alone. Deployment and the remaining proof must be completed before closing the findings.
