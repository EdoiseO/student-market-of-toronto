# Deployment and operations

## Current rollout status

Verified on 8 September 2026 (UTC): [PR #76](https://github.com/EdoiseO/student-market-of-toronto/pull/76) is merged and production serves commit `6c77cea2`. The application build is live, but migration `20260907202430_route_private_message_media_through_gateway.sql` is absent from production. Its media resolver, relocation ledger and account-cleanup resolver are also absent.

Private attachment requests therefore fail after authorization. Account deletion can fail after durable upload retirement and listing cleanup have already run. Do not use account deletion until the missing migration and cleanup path are verified. A successful Vercel build does not apply database migrations or complete this rollout.

The immediate work is to reconcile live migration history, apply the exact missing migration with preservation guards, and complete the legacy-media cutover below against the verified deployed application. Do not roll back to signed private-image delivery. Update this status after a production read-back confirms completion.

## Release prerequisites

- Reconcile the target's migration history and actual database objects. The repository extends an existing baseline; it is not an empty-project bootstrap. Preserve historical SQL timestamps and source, including the [registered demo identity contract](security/registered-demo-identities.md). Do not mark a migration applied without executing it or repair history blindly.
- Verify the target's Supabase URL, publishable key and server-only service key. Build production with production configuration; never promote a staging build. Keep credentials, account mappings, inventories and execution receipts outside Git.
- Confirm green CI and required independent review before merging. Verify authorization, [private media](security/private-media-staging.md), [Realtime](security/moderation-realtime-staging.md), [recovery](password-recovery.md) and [browser/device behavior](../scripts/demo-browser-check/README.md) in isolated staging. Record unsupported hardware checks as untested.
- Configure the two background workers and their bearer secret as described in the [README](../README.md#background-workers). The application does not schedule itself.

## Private-media cutover

The normal release order is database compatibility followed promptly by application promotion. If the application is already live without its resolver, verify that exact deployment and repair the missing database dependency first, then complete the remaining containment and cache-retirement steps. Do not treat restored attachment loading as proof that old cached URLs have been retired.

1. Read the current migration history and private-object inventory. Preserve the private demo registry, school-validation helper, existing migration records and attachment identities. Prepare the exact pending source and guarded transaction without executing it; stop if the expected baseline or source hashes differ.
2. For a new application release, prepare a production-environment Vercel deployment with `--prod --skip-domain`. Verify READY, exact project and commit, and no aliases before promotion. For an already deployed release, verify its actual production identity and configuration instead of assuming a preview is equivalent.
3. Protect historical deployments that can still issue signed URLs. Set the supported `skewProtectionBoundaryAt` cutoff to the verified safe deployment's creation timestamp, ensuring every vulnerable deployment is older. Preserve unrelated project settings and existing deployment protection. With the safe production candidate READY, execute the guarded exact gateway migration and promptly promote that candidate. Expect old client pages to need a reload during the compatibility interval.
4. Confirm old immutable deployments and team/branch aliases are inaccessible to ordinary visitors. Freeze the final legacy inventory after the old public runtime is retired, accounting for in-flight requests. A cache purge alone cannot prevent old server code from signing new URLs.
5. Follow the [exact-inventory relocation procedure](security/message-media-relocation.md): copy, verify identity/metadata and byte hashes, activate the mapping, verify authorized delivery, remove the exact original through Storage, and retain the resumable ledger. Do not bulk-delete objects or rewrite immutable attachment records.
6. Wait until the retained original Storage URLs deny bytes **before** purging the Vercel CDN/image cache. Otherwise the optimizer can refill from the old source cache. Replay the original URLs, query parameters and Accept variants; fresh URLs, cache nonces or token expiry are not substitutes.
7. Verify the canonical site rejects historical `dpl`, `x-deployment-id` and `__vdpl` pins while the current deployment, participant access, retained-token demotion denial, public listing images, video ranges, account cleanup and recovery pages work. Record migration, deployment and alias read-backs separately from browser results.

Storage cache propagation can be delayed. Already downloaded bytes cannot be recalled. If a check fails, preserve the receipt and repair the deployed boundary; do not restore permissive private-media policies as a rollback. See the [delivery design](security/private-message-media.md) for the authorization guarantee and its limits.

## Demo scope and onboarding

Custom SMTP, a branded sender and general student-inbox delivery are deliberately deferred for this demo. The Supabase Auth/recovery implementation remains in place, with its recipient limitation shown in the interface. A suitable SMTP sender and a successful institutional-inbox recovery test are required before real student onboarding; an organization-owner inbox test does not establish general delivery.

Mirrored iPhone gallery checks and desktop viewport checks have passed, but direct touch, software-keyboard layout, rotation and physical accessibility checks remain unverified. Keep those limits separate from CI and hosted API results. Test account retirement in isolation before offering account deletion on the completed production rollout.
