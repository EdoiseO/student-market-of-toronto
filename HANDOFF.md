# Student Market of Toronto handoff

Updated: 2026-09-07 (America/Toronto)

## Current implementation checkpoint — 2026-09-07

Production database rollout is complete; the application release is not. Exact versions `20260906144154`, `20260906150000`, `20260907180439`, and `20260907190013` were applied with guarded transactions and verified source hashes. History now has 58 rows; the original 54 rows, all nine demo-registry identities, and the school-validation helper were preserved. Do not replay the executed rollout wrappers or repair history blindly. The already-live demo migration `20260906160016` remains unchanged.

Production Auth now uses the canonical Vercel Site URL and narrow `/auth/callback` and `/reset-password?state=*` redirects. The school hook, confirmation policy (off), and built-in SMTP were preserved. No production user password or account was changed. Custom SMTP is still required for general student recovery delivery.

An isolated free Supabase project in Phillips Org contains the production schema without production records and the release migrations. Hosted current-role Data API authorization passed, including retained-token demotion and staff boundaries. **The strict Storage gate failed:** a warmed private image returned a CDN HIT after demotion. Separate fresh-request and signing denials passed, but do not replace the failed assertion. Immediate cached-media revocation and existing signed capability lifetime remain unresolved.

Two controlled staging recovery emails were delivered. The first submission expired at the provider; the second successfully changed the fixture password, revoked the old refresh session, rejected replay, and preserved a different account's browser session. Same-account hosted cookie clearing and production student-inbox delivery remain outstanding. The personal test inbox is an isolated fixture, not a production school-domain exception. Ordinary non-school/signup-positive controls passed.

Local runtime revision `37699ab` passed 341/341 security tests and the production build. The subsequent `6910212` hosted-harness fix selects the actual composite-key reaction column and preserves the authorization assertions; its focused checks passed. See `docs/security/release-check-2026-09-07.md` for precise evidence and remaining checks. Recheck GitHub for CI on the current head.

PR #76 is open and requires independent approval. Do not bypass repository review protections. Production still serves application revision `6a98cb1866a587c656309356d753f0b2386ddfe1`. The user has already authorized rollout after checks pass; another deployment permission request is unnecessary. Keep the reverted portfolio unchanged and preserve unrelated stash `e4003da7e2dfbb9b08fac21c22cc9143e90130b7`.

Operational receipts, frozen executed SQL wrappers, and cache diagnostics are outside Git under `/Users/edoise/Documents/Codex/2026-09-06/rev/outputs/`. Staging credentials, inbox mappings, code-bearing links, and fixture manifests are in the private staging directory under that workspace; never import them into Git. Keep fixtures available until the outstanding recovery test is finished, then use trusted cleanup workflows.

## Historical implementation checkpoint — 2026-09-06

The approved redesign/security implementation and exact already-applied demo-email migration are committed and synchronized into the original application checkout. All earlier dirty/untracked implementation work remains preserved in stash `e4003da7e2dfbb9b08fac21c22cc9143e90130b7`; do not blindly apply or drop it.

Current local validation: `npm run test:security` **322/322 passed**, lint passed, production build passed, dependency audit zero vulnerabilities, and demo migration integration **15/15 passed**, including fresh and already-live migration orders. Final browser QA covered 24 responsive/locale cases, both language switches, and six listing/report photo open/zoom/Escape/focus checks with no failures after waiting for dialog close completion. The final release check also passed Linux/macOS CI, five preview HTTP controls, and the guarded migration transaction rehearsal. See `docs/security/release-check-2026-09-06.md`. Hosted signed-token/Storage/Realtime, dedicated inbox-backed Auth delivery and full device/accessibility gates remain pending; do not declare the release verified in production.

Read `docs/security/registered-demo-identities.md` before database deployment. Exact migration `20260906160016` is already live and must not be reapplied/renamed. Our older `20260906144154` and `20260906150000` migrations remain pending. Preserve the private registry and STABLE definer school helper, and deliberately reconcile the three older pre-repository history entries without blind repair. New demo addresses are recorded in `/Users/edoise/Documents/Codex/2026-09-06/student-market-demo-cleanup/demo-accounts.csv`; existing passwords still apply, but those accounts cannot receive recovery emails. No affected saved login fixture was found. No cleanup backup or live mapping was imported into Git.

The user explicitly authorized a final security check followed by production rollout. The implementation branch was pushed and draft PR #76 opened; production deployment, pending migrations and Auth settings remain unchanged. No new deployment approval is needed once the remaining checks pass. Staging environment selection and an inbox-backed recovery test account were requested and remain pending. The separate cleanup task's applied migration is acknowledged above; the August statements below are historical.

## Start here

- Repository: `/Users/edoise/Documents/Codex/2026-08-11/https-github-com-edoiseo-student-market/work/student-market-of-toronto`
- Remote: `https://github.com/EdoiseO/student-market-of-toronto.git`
- Working branch at handoff preparation: `agent/redesign-message-media`
- Read `AGENTS.md` before editing. This repository uses Next.js 16.3.0; consult the relevant local guides under `node_modules/next/dist/docs/` before changing Next.js code.
- Use one agent by default. Do not start parallel sub-agents unless the user explicitly requests them.
- Inspect `git status`, recent history, GitHub, Vercel, and Supabase before relying on this checkpoint.
- Do not expose `.env.local`, service-role keys, or other secrets.

## Implemented release scope

The branch contains the complete Stage 1 through Stage 8 moderation and security work plus the reviewed UI changes:

- Role-aware admin Overview, Reports, Listings, Conversations, Enforcement, Users, Announcements, and Audit surfaces.
- Evidence-backed listing, profile, and message report review.
- Consistent report detail hierarchy and responsive loading skeletons.
- Report Back links and completed actions return to `/admin/reports`.
- Append-only private moderator-note timelines with stable retry IDs and immutable audit records.
- Trusted listing decisions, report decisions, sanctions, role changes, announcements, message sends, and media cleanup.
- Full-height desktop messaging with visible global search, bounded message history, media attachments, reactions, responsive drag-and-drop, and mobile behavior.
- Rejected-listing edit feedback for unchanged submissions.
- Account standing, ban enforcement, participant-safe notifications, and durable announcement delivery.
- Stage 8 fixes for school-email changes, listing reservation MIME/size binding, expired message-operation cleanup, and abort-rate-limit bypasses.
- Stage 8 database advisor hardening for legacy function search paths and trigger-only function execution grants.

## Verified release gates

The final local tree, including the reconciled append-only note migration order, was verified on 2026-08-17:

- Focused application and fresh PostgreSQL chain: 16/16 passed.
- `npm run test:security`: 268/268 passed.
- `npm audit --audit-level=moderate`: 0 vulnerabilities.
- `npm run lint`: passed.
- `npm run build`: passed with Next.js 16.3.0 and 30 generated pages.
- `git diff --check`: passed.

PostgreSQL-backed tests need shared-memory access. A sandboxed `shmget ... Operation not permitted` error is an environment restriction, not an application failure.

Node prints non-failing `MODULE_TYPELESS_PACKAGE_JSON` warnings for a few imported `.js` modules. Do not add `"type": "module"` casually because that changes repository-wide module semantics.

## Security scan

Standard scan `b0d52dae-d485-4707-9015-5325a158c99c` completed with full 8/8 attack-surface coverage at revision `acf2fd8676be7249cc3533826c35c4de31a0cf1f`.

It found four Medium, high-confidence issues and no High or Critical issues:

1. School eligibility was not rechecked on Auth email changes.
2. Listing uploads were not bound to the reserved final MIME type and byte size.
3. Expired pending message operations were not terminalized and scrubbed.
4. Existing pending operations could bypass the abort quota.

All four were remediated in the tracked Stage 8 migration and covered by regression tests. The sealed report is at:

`/private/var/folders/46/fw5sh4tn3954vyqsk7xm1qh80000gn/T/codex-security-scans-ZE53LQ/student-market-of-toronto/acf2fd8676be7249cc3533826c35c4de31a0cf1f_20260817T114108Z_2kv5t5i0/report.md`

The one-agent project rule prevented an independent second-agent baseline. Disclose that limitation if reporting scan assurance.

## Supabase state

Connected project: `bmnfynufuqjwjmtlfdxf`.

Live migration history was read back after application. The latest tracked migrations are:

- `20260817120920_stage8_release_security_hardening.sql`
- `20260817121321_stage8_advisor_hardening.sql`
- `20260817121744_append_only_report_moderator_notes.sql`

The append-only migration was absent from remote history even though the legacy single-note function existed. It was applied once through the migration API, given the server version `20260817121744`, and its public and private functions were verified present. Do not reapply it or paste it manually.

The final Supabase advisor review left only:

- 13 informational RLS-without-policy notices for deliberate deny-by-default internal tables.
- 7 warnings for intentional authenticated SECURITY DEFINER RPC boundaries that validate `auth.uid()` and ownership or participation.
- The leaked-password-protection advisory, which cannot be enabled on the connected Free plan.

Search-path warnings and broad trigger-function execution grants were cleared. Treat these statements as verified live state on 2026-08-17, but recheck current state before future schema work.

## Release and deployment state

Production release was explicitly authorized in the initiating task. At the time this file was prepared, the release gates and live database prerequisites were complete, but the final GitHub push, Vercel production deployment, and post-deployment browser verification were still in progress. Verify the current remote and deployment state instead of assuming completion from this file.

Production domains:

- `https://student-market-of-toronto.vercel.app`
- Portfolio case study: `https://philliponofua.vercel.app/student-market.html`

Vercel deployments are immutable. Never delete or promote production without explicit authorization. When replacing a review preview, verify the replacement is READY before deleting the older preview so one review preview remains.

## Working rules for future continuations

- Preserve existing changes and inspect before editing.
- Use tracked migrations and compare local and remote migration history before database changes.
- Keep service-only data and functions private. Preserve RLS, bounded reads, idempotency, and trusted-RPC boundaries.
- Run focused tests, the full security suite, lint, build, dependency audit, and `git diff --check` for release changes.
- Clearly distinguish locally verified facts, live read-back facts, and historical state.
- Do not start backlog work, commit, push, deploy, or mutate Supabase without the relevant user authorization.
