# Moderation fixtures and legacy authorization checks

This harness provisions isolated authorization fixtures and verifies retained-token Data API access. Its Storage assertions describe the legacy direct-download/signing model. After migration `20260907202430`, direct client Storage access is deliberately denied; use the [authenticated private-media checks](private-media-staging.md) for the current gateway. Do not interpret an incompatible legacy Storage assertion as a reason to restore direct download access.

Native PostgreSQL tests do not establish hosted Auth, PostgREST or CDN behavior. A warmed Storage response can outlive a permission change; a fresh cache query or denied new signature does not prove revocation of the original URL. Follow the [deployment and cache-retirement procedure](../deployment.md) for release verification.

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

The script emits a nonsecret JSON result. Retain the assertion and deployment versions for diagnosis. A failed applicable authorization assertion blocks release; legacy Storage expectations must be interpreted against the schema version described above. Do not change a denied read to an allowed expectation to conceal a failure.

Auth bans, application bans, deleted accounts, canonical role parsing, public/own bios, all action values, explicit notification column grants, unknown legacy dependencies, and rollback atomicity are covered in the native regression suite. A deployment-specific full rollout check should additionally exercise Auth/application ban transitions through the application's trusted administrator workflows and inspect the actual deployed catalog. This script does not claim browser route, Realtime delivery, downstream email, or existing signed-URL expiry timing coverage.

## Cleanup

First delete the synthetic listing/media and accounts through the staging application's normal account deletion workflow, which runs trusted cleanup for reservations and private ledgers. Then run:

```sh
node scripts/verify-moderation-authority-staging.mjs cleanup /absolute/private-authority-fixture.json
```

Cleanup verifies each exact account ID and fixture marker before requesting deletion. It reports any failed account deletion and preserves the manifest for retry; it does not disable triggers, rewrite policies, or bypass retention guards. After successful deletion it overwrites the manifest with a nonsecret receipt. Dispose of the isolated deployment to remove retained audit/tombstone receipts. This does not modify production or publish a deployment.
