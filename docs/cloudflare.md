# Cloudflare migration candidate

This branch adds vinext alongside the existing Next.js scripts, targeting Cloudflare Workers. It is a candidate for staging verification, not a completed production migration. Supabase remains the database, Auth, Storage and Realtime provider.

The initial Worker is named `student-market-free-test`. It has no routes, cron triggers, paid bindings, or production domain attached. Runtime public Supabase settings are copied from the build environment into text bindings. Supply those values before building; do not deploy empty bindings.

## Verification so far (November 2, 2026)

- Production Workers build and `cf deploy --prebuilt --dry-run` passed. Upload: 3422.46 KiB uncompressed, 881.23 KiB gzip, 165 static assets.
- Local Workers runtime: homepage, login, registration, and public messaging shell return 200; `/dashboard` redirects to login; anonymous private media returns 401 with private/no-store headers; nonexistent page returns 404. Browser homepage renders public listings without console warnings/errors.
- Local security suite: 332 passed, 9 failed, 37 skipped. Remaining failures involve Windows path/POSIX permission assumptions; PostgreSQL integration checks need the existing Linux/macOS CI. Do not describe this as a fully passing security suite.
- These checks do not measure hosted CPU consumption or establish eligibility for the free plan. Hosted CPU/error measurements, authenticated flows, server-only secrets and database rollout verification remain outstanding.

## Build

Use Node 24.22.0 or newer supported by the pinned cf CLI. Run `npm ci`, then `npm run build:vinext`. Use `npm run start:vinext` to preview the built Worker and `npm run deploy:vinext` only after signing into the intended Cloudflare account and configuring the environment. Existing `npm run dev`, `build`, and `start` remain Next.js commands.

The migration requires React/React DOM/RSC 19.3.1 to satisfy vinext's peer dependencies. Added packages are pinned; the lockfile records the complete dependency graph. The Babel runtime transform is pinned to 7.29.7 to avoid the Babel 8 peer conflict with the existing shadcn toolchain.

## Configuration

- Supply `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY` to both the build and the Worker runtime. These are public browser configuration.
- Store `SUPABASE_SERVICE_ROLE_KEY` and `CRON_SECRET` as runtime secrets. Never put them in source, public variables, screenshots, or build artifacts.
- Preserve the optional `NEXT_PUBLIC_LISTING_EDIT_REVIEW_REQUIRED` setting if configured on Vercel.
- Add the final Cloudflare authentication callback and recovery URLs to Supabase's redirect allowlist; update Site URL at cutover. Keep the old URLs during the verification window.
- Identify the existing external scheduler before cutover. Repoint the announcement and listing-image cleanup requests to the new origin with their bearer secret; avoid running duplicate schedules. This branch does not create a new scheduler.

Shared HTML/data caching and Cloudflare image transformations are deliberately disabled in this first candidate. Images are delivered without adapter resizing. Verify image sizes and performance before release, including private media's no-store behavior. Static asset routing sends requests through the Worker except Next.js static bundles.

## Release checks

The repository's `docs/deployment.md` reports an unresolved private-media database rollout as of September 8, 2026. Reconcile current production state before any cutover; a hosting move does not repair that database dependency. Do not execute SQL migrations automatically as part of this hosting change.

Run the existing security suite and check the built Worker with isolated staging configuration: login/logout and session refresh, password recovery, protected-route redirects, listing creation/editing, uploads, participant-only private media, video ranges, Realtime messaging, admin authorization, and scheduled endpoints. Confirm secrets are absent from client bundles. Confirm account deletion only after its database prerequisites are resolved. Compatibility scanning alone does not prove runtime correctness.

Once staging passes, deploy with production configuration, verify again, then change domain routing or public links. Vercel-owned `vercel.app` addresses cannot move to Cloudflare. Preserve a verified rollback deployment and address the old-runtime protections described in `docs/deployment.md` before retirement. Update portfolio links and canonical/social metadata after final hostnames are assigned.

## References

- https://developers.cloudflare.com/workers/framework-guides/web-apps/nextjs/
- https://developers.cloudflare.com/workers/platform/pricing/
- https://supabase.com/docs/guides/auth/redirect-urls

Cloudflare currently recommends vinext, which is beta. Its static compatibility report found 17 supported checks and partial image support; hosted integration checks remain required. Costs depend on actual Worker CPU, traffic and any optional services; Supabase billing is separate.
