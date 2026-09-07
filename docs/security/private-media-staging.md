# Private media HTTP staging gate

`scripts/verify-private-media-staging.mjs` is an opt-in operator tool for an **isolated staging app and database**. Merely importing it or running its offline tests makes no network requests. A hosted invocation does sign in four existing synthetic fixtures and temporarily change the exact moderator fixture's application role. It sends no email, creates no users/media, changes no password, and never changes Auth configuration.

Use it only after the authenticated `/api/message-media/[attachmentId]` gateway and its corresponding Storage-read migration are present on the target. A passing local HTTP run does not establish HTTPS/CDN behavior; repeat against the final isolated HTTPS candidate. It does not substitute for browser rendering, physical-device, Realtime, signed-capability retirement, or recovery/session tests.

## Inputs and prerequisites

- Reuse the **private version-1 manifest** created by `scripts/verify-moderation-authority-staging.mjs`: exact `project`, `url`, `runId`, the four `users` named `buyer`, `seller`, `staff`, `moderator`, and `fixture.conversationId` / `fixture.mediaPath`. The manifest must be owner-readable only (`0600`). Do not copy it into Git. No new fixture provisioner is needed.
- The conversation must belong to that buyer and seller and contain only `[authority-<runId>]` messages. The referenced attachment must be their uploaded synthetic **image**, with a supported MIME type and size from one byte through 10 MiB. The service resolver must return exactly one existing object. The verifier downloads that object with the service client to establish its size and SHA-256 before trying denials.
- Buyer and seller must be ordinary, unrestricted users. Staff must have the limited `staff` role; both staff and moderator are nonparticipants. All users must still carry the exact manifest `fixture_run` marker. The script changes only the moderator's `role`/`roles`, preserving other metadata. Explicit JSON nulls in the moderator's original `role` or `roles` cause an early refusal because Auth's merge API cannot restore those values exactly. Do not edit fixture metadata merely to bypass this guard without understanding the saved state.
- Do not run another role-changing verifier against these four accounts concurrently. Ordinary sessions must have at least four minutes left when issued. The HTTP run has a three-minute deadline and a 20-second deadline per request; final restoration uses fresh bounded requests even after interruption or the probe deadline.
- The app must be the exact intended candidate, use the same isolated database, and have all required server-side environment variables. Confirm that deployment identity/configuration independently. The verifier does not read app environment files or establish which commit a server runs. Do not use production accounts, origins, tokens or keys.

Supply the existing private environment securely; never put values in a checked-in file or shell history:

| Variable | Value |
| --- | --- |
| `SMOT_STAGING_URL` | Exact isolated Supabase origin, without trailing slash; local Supabase is also supported. |
| `SMOT_STAGING_ANON_KEY` | Its ordinary publishable/anon key. |
| `SMOT_STAGING_SERVICE_ROLE_KEY` | Its service key, used only for fixture ownership, source-object reads and exact moderator-role restoration. |
| `SMOT_AUTHORITY_STAGING_ACK` | `disposable:<project-ref>` or `disposable:local`. |
| `SMOT_PRIVATE_MEDIA_APP_ORIGIN` | Exact isolated HTTPS app origin; HTTP is accepted only for `localhost`/`127.0.0.1`. |
| `SMOT_PRIVATE_MEDIA_APP_ACK` | `isolated:<exact-app-origin>`. This acknowledges the role-changing staging run. |
| `SMOT_PRIVATE_MEDIA_VERCEL_BYPASS` | Optional existing Vercel protection bypass secret for this app. |
| `SMOT_PRIVATE_MEDIA_BYPASS_ORIGIN` | Required when a bypass is supplied; must equal the exact app origin. |

Known production app and Supabase hosts are forbidden. The operator must also verify that any other hostname is staging. App and database origins must differ. The bypass header is added only to the acknowledged app origin; credentials never follow redirects. A protected deployment returning a redirect or login HTML fails the gate rather than silently authorizing access.

## Invocation and evidence

Choose a fresh absolute receipt path outside all Git repositories, in an existing private output directory:

```sh
node scripts/verify-private-media-staging.mjs verify \
  /absolute/private/authority-fixtures.json \
  /absolute/private/media-http-receipt.json
```

The receipt contains only named checks, response statuses, cache-header facts, the synthetic object's byte count/hash and restoration result. It excludes emails, object paths, JWTs, cookies, passwords, keys, bypass values and provider error bodies. Raw bytes and sessions stay in memory; the receipt does not log URLs or `Set-Cookie` values.

The 35 checks establish:

1. Buyer, seller and a current moderator receive exactly the service-downloaded image at one fixed gateway URL; the moderator repeats the same URL to warm any cache. Participant HEAD and single-byte Range reads work. Unrelated staff receives 404 and anonymous access receives 401.
2. Direct Storage authenticated download, SDK download and signing requests are denied for all four browser identities and anonymous access, even while the moderator is privileged. Requests address the exact object that the service just read, so a missing object cannot masquerade as the positive control.
3. After committed moderator demotion, the original JWT still passes ordinary Auth `getUser`. Exactly the same serialized SSR cookie is reused for GET, HEAD, Range, HEAD+Range, `If-None-Match: *`, and Range+`If-None-Match`; each must return 404. The token is checked again afterward. Response `Set-Cookie` values are discarded, and the runner never refreshes or replaces these sessions.
4. Demoted direct Storage access remains denied, buyer/seller gateway access continues, and the anonymous private image optimizer request returns 400 without the image. Every gateway response must carry `no-store`, no reusable ETag/Last-Modified, no Location and no 304. CDN no-store headers are checked when visible; positive cache age or a CDN hit fails the check. Absent platform-stripped CDN headers are recorded, not invented.

The script exits nonzero on any failure or unverified restoration. Do not accept an inactive/expired session, missing fixture, 5xx response, wrong deployment, or invalid bypass as a successful authorization denial. Diagnose the specific failed check, correct the prerequisite or candidate, then rerun with a fresh receipt path. Keep the old failed receipt as evidence.

Before its first role update, the verifier writes `<receipt>.restore-private.json` exclusively with mode `0600`. This contains the exact moderator UUID, fixture marker and original application metadata, but no credentials. `finally` restores and reads back the exact original metadata, then deletes this journal. A single SIGINT/SIGTERM stops probes while allowing restoration. A hard kill or process/machine failure cannot guarantee cleanup: if the journal remains, use the existing manifest and service administration to restore **only that exact synthetic fixture**, verify equality, and retain the journal until verified. Do not overwrite or delete a surviving journal to force a rerun. No hosted data is created for cleanup by this verifier; reuse the already authorized manifest-owned fixture cleanup after all release checks finish.

## Offline validation

```sh
node --test tests/private-media-staging-verifier.test.mjs
node node_modules/eslint/bin/eslint.js scripts/verify-private-media-staging.mjs tests/private-media-staging-verifier.test.mjs
```

The offline HTTP fixtures exercise the real installed Supabase SDK and SSR cookie serializer. They test unchanged-cookie demotion, failing stale authorization, inactive-session rejection, redirect isolation, bounded media reads, refusal to inspect mixed real content, and restoration success/failure. These are local orchestration tests, not hosted execution evidence.
