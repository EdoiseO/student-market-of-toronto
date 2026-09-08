# Isolated moderation-authority platform check

This is a release gate, not a production probe. Native PostgreSQL regressions exercise real RLS and the migration chain, but do not verify Supabase Auth token issuance, PostgREST, Storage downloads, or URL signing. The harness must pass against a disposable Supabase deployment with the complete current schema and migration chain.

**7 September 2026 result: failed Storage revocation gate.** A free isolated project in Phillips Org now contains the production schema without production records, plus the four release migrations and synthetic fixtures. Moderator/participant positive controls, unrelated staff denials, bounded report context, and same-token Data API denials after committed demotion passed. The unchanged authenticated Storage URL returned `200`, `CF-Cache-Status: HIT`, and `Cache-Control: public, max-age=3600` after demotion. Separate requests with a fresh cache query and new URL signing were denied. Those diagnostics establish a narrower origin authorization result; they do not turn the strict same-URL assertion into a pass. See the [release check](release-check-2026-09-07.md).

The harness refuses production project `bmnfynufuqjwjmtlfdxf`, does not load project `.env` files, requires a target-specific acknowledgement, and creates only four accounts marked with a unique fixture run ID. It never prints keys, passwords, tokens, message bodies, or signed URLs. Auth admin creation confirms the synthetic email without sending an email.

## Prepare and provision

Use a disposable project or local Supabase stack. Apply the normal complete application schema and migrations there. Do not point the staging application at production services or enable outbound email workers. Do not create a paid branch as an incidental test step.

Set these variables through your local secret mechanism; avoid putting values in shell history:

- `SMOT_STAGING_URL`: isolated Supabase URL, or local stack URL.
- `SMOT_STAGING_ANON_KEY`: isolated anon/publishable key.
- `SMOT_STAGING_SERVICE_ROLE_KEY`: isolated service-role/secret key.
- `SMOT_AUTHORITY_STAGING_ACK`: `disposable:<project-ref>`, or `disposable:local`.

Run from the repository:

```sh
node scripts/verify-moderation-authority-staging.mjs provision /absolute/private-authority-fixture.json
```

The manifest is owner-readable only and contains ephemeral credentials. Keep it outside the repository. Provisioning records each account immediately, so an interrupted run has an exact cleanup list.

## Build the synthetic fixture through normal app flows

Use the manifest's seller and buyer credentials in the isolated application. Complete any required profile setup. This intentionally exercises the normal trusted listing, message, upload, and report workflows; raw inserts or edits to `storage.objects` do not establish a valid Storage test.

1. Seller creates a complete listing; use the normal moderation workflow to make it active.
2. Buyer starts a conversation with that seller.
3. Send at least nine messages. Start **every message body** with `[authority-<runId>]`, using the manifest's exact run ID.
4. Attach a small synthetic image through the normal message upload workflow. Add a reaction to a message so its SELECT policy has a positive control.
5. Buyer or seller reports a middle message, with at least two earlier and two later messages.
6. Add the exact `conversationId`, `reportId`, and attached `mediaPath` to the manifest's `fixture` object. Obtain these from the isolated app/network inspector or an administrator's read-only catalog inspection.

The harness checks that conversation participants are its own two synthetic accounts, the report belongs to that conversation and was submitted by one of them, all message bodies carry its run marker, and the media path is attached to that conversation. It refuses unrelated data.

## Verify the unchanged signed token

```sh
node scripts/verify-moderation-authority-staging.mjs verify /absolute/private-authority-fixture.json
```

The harness signs in synthetic users once and holds their real issued access tokens only in memory. Its Data API and Storage requests send those exact tokens, without refresh. It verifies:

- Current moderator and ordinary participant can read the seeded conversations, messages, attachments, and reactions, download the object, and sign its URL.
- Staff cannot read those unrelated private resources through Data API or Storage, but can retrieve the bounded report context.
- After the administrator commits the moderator's demotion, the exact earlier token loses those reads, new URL signing, report-context execution, and notification INSERT.
- A staff token also cannot manufacture the notification.
- The same original moderator token follows later current-account changes to staff, forced-name restriction, and restored moderator authority.
- Participant access survives those changes.
- A media URL issued before demotion remains usable during the run. This is a retained bearer capability. The harness does not measure its expiry or the lifetime of a cached response; signed-token expiry alone is not a verified cache-revocation deadline.

The script emits a nonsecret JSON result. A failure is a failed release gate; retain the assertion and deployment versions for diagnosis. Do not change a denied read to an allowed expectation to get a pass.

Auth bans, application bans, deleted accounts, canonical role parsing, public/own bios, all action values, explicit notification column grants, unknown legacy dependencies, and rollback atomicity are covered in the native regression suite. A deployment-specific full rollout check should additionally exercise Auth/application ban transitions through the application's trusted administrator workflows and inspect the actual deployed catalog. This script does not claim browser route, Realtime delivery, downstream email, or existing signed-URL expiry timing coverage.

## Cleanup

First delete the synthetic listing/media and accounts through the staging application's normal account deletion workflow, which runs trusted cleanup for reservations and private ledgers. Then run:

```sh
node scripts/verify-moderation-authority-staging.mjs cleanup /absolute/private-authority-fixture.json
```

Cleanup verifies each exact account ID and fixture marker before requesting deletion. It reports any failed account deletion and preserves the manifest for retry; it does not disable triggers, rewrite policies, or bypass retention guards. After successful deletion it overwrites the manifest with a nonsecret receipt. Dispose of the isolated deployment to remove retained audit/tombstone receipts. This does not modify production or publish a deployment.
