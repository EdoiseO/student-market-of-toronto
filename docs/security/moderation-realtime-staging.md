# Retained-token hosted Realtime gate

`scripts/verify-moderation-realtime-staging.mjs` verifies Postgres Changes against the **existing synthetic authority fixture**. It creates no accounts or schema and never seeds rows with the service role. A successful receipt covers this bounded Realtime exercise only; it does not supersede Storage/CDN, device, accessibility, or release gates.

Use an isolated staging project and the private, owner-readable manifest created by the [authority fixture workflow](moderation-authority-staging.md). Its four distinct accounts, exact Auth fixture markers, conversation participants, report, attachment, and at least nine synthetic messages must still match. The listing must be active and the accounts must be able to use normal settings/message operations. Stop other scripts using these accounts while this gate runs, especially scripts changing moderator roles. Do not use production identities or production data.

The operator supplies these environment variables through the existing private runner; never paste their values into logs or commit them:

- `SMOT_STAGING_URL`: isolated Supabase origin.
- `SMOT_AUTHORITY_STAGING_ACK`: `disposable:<that-project-ref>` (or `disposable:local` for a local stack).
- `SMOT_STAGING_ANON_KEY` and `SMOT_STAGING_SERVICE_ROLE_KEY`: keys belonging to that isolated target.

Run from the exact candidate checkout, recording its Git revision separately:

```sh
node scripts/verify-moderation-realtime-staging.mjs verify /absolute/private-authority-fixture.json
```

The production project is explicitly forbidden, even with a matching acknowledgement. Arbitrary domains, redirects, origin credentials/path/query, incomplete fixtures, and shared-readable manifests are rejected. This script never reads `.env` files. No hosted calls occur in its offline tests:

```sh
node --test tests/moderation-realtime-staging.test.mjs
npx eslint scripts/verify-moderation-realtime-staging.mjs tests/moderation-realtime-staging.test.mjs
```

## What the hosted run changes and proves

Each account signs in once. A separate observer client uses a fixed `accessToken` callback returning the original JWT, including during heartbeats and reconnects. The moderator token must contain the original moderator claim and remain unexpired for the bounded run. Passwords, JWTs, raw errors, frames, message bodies, and signed URLs are never included in the JSON receipt.

Every observer subscribes to app-shaped message/reaction filters, its own notification signals, and a raw schema-wide Postgres Changes stream. Non-buyers also attempt a signal filter targeting the buyer. The harness requires both channel subscription and a successful Postgres subscription system event. Each round requires fresh own-signal delivery on both scoped and broad streams for **all four observers**. A timeout, dead channel, missing positive, or denied setup operation is a failed/incomplete gate, never a successful denial.

| Round | Buyer/seller | Staff unrelated to conversation | Moderator, same original JWT |
| --- | --- | --- | --- |
| Initial authority | Message INSERT, reaction INSERT/UPDATE | No conversation events | Same positive events |
| Committed demotion, channel kept open | Positive events continue | No conversation events | No conversation events |
| Reconnected while demoted | Positive events continue | No conversation events | No conversation events after reconnect |
| Current role restored | Positive events continue | No conversation events | Positive events resume on the reconnected channel |

Each round sends one seller message through `send_conversation_message_idempotent`, inserts a buyer reaction through the same authenticated RLS-protected operation as the UI, and soft-removes that reaction. These four messages retain the fixture's synthetic prefix. The script saves each account's current `messages` notification preference through the normal authenticated settings upsert, preserving effective email/in-app values and updating its timestamp; absent preference rows become explicit defaults. Those saves generate real, recipient-owned signal positives even for unrelated staff. A disabled buyer in-app preference is a fixture prerequisite failure rather than something the harness overrides.

The buyer must also retrieve the new notification through its protected Data API. Both participants and the initially privileged moderator must receive message/reaction events before denial rounds can proceed. After the last required positive, every round observes a further five seconds and cross-checks message visibility through Data API with the exact retained token. Neither broad subscriptions nor a caller-selected foreign recipient filter may bypass RLS. Signal rows must contain only `recipient_user_id`, `version`, `change_kind`, and `emitted_at`; any observed legacy `notifications` payload fails the gate.

The harness changes only the exact fixture moderator's `role`/`roles` metadata. It rechecks ownership before mutations and restores the original values in `finally`, including after timeouts or handled interrupts. It closes channels without globally signing out accounts. Successful restoration is part of the result. SIGKILL, machine loss, or unavailable Auth can prevent cleanup: retain the private manifest, inspect the failure receipt, and have the operator restore only that fixture account. Repeated runs add another four synthetic messages and reaction tombstones; normal trusted fixture cleanup remains the operator's responsibility. An uncertain write may have committed even when the receipt cannot count it.

## Evidence and boundaries

Save the nonsecret JSON output and exit status beside the exact source SHA, staging ref, and a separate read-only catalog receipt. Expected publication membership is `messages`, `message_reactions`, `notification_realtime_signals`, and `announcement_deliveries`, with `notifications` absent. Runtime signal/message positives plus zero legacy payloads exercise that exclusion; they do not replace catalog evidence or intentionally exercise a notification hard DELETE.

Supabase documents [per-subscriber authorization of Postgres Changes](https://supabase.com/docs/guides/realtime/postgres-changes), including the special DELETE/RLS limitation. The [Realtime protocol](https://supabase.com/docs/guides/realtime/protocol) distinguishes a joined channel from a ready Postgres subscription. [Broadcast/Presence authorization caching](https://supabase.com/docs/guides/realtime/authorization) is a separate mechanism; this app's verified subscriptions use Postgres Changes. This harness exercises committed role changes with a valid retained token and does not change the app architecture.

Still separate: deleted/banned/forced-name identities, token expiry, transport outages and browser UI catch-up, explicit unmount cleanup, announcement delivery, notification DELETE workload, physical mobile Safari/Chrome, keyboard/focus/zoom, recovery email, and private-media cache behavior. No one of those becomes green because this script passes. The five-second denial window is bounded evidence, not a guarantee that no delayed event can ever arrive.
