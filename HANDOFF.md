# Student Market of Toronto handoff

Updated: 2026-08-17 (America/Toronto)

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
