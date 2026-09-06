# Student Market of Toronto

A student marketplace for discovering items, managing listings, and arranging sales through listing-linked conversations. The application also includes moderation, reporting, account enforcement, and tools for reviewing listing photos and conversation evidence.

[Live demo](https://student-market-of-toronto.vercel.app) · [Project case study](https://philliponofua.vercel.app/student-market.html) · [Release work: PR #76](https://github.com/EdoiseO/student-market-of-toronto/pull/76)

Built with **Next.js 16, React 19, Tailwind CSS 4, and Supabase** (Auth, PostgreSQL, Storage, and Realtime). Vercel hosts the application.

## Release status

**6 September 2026:** this branch includes the mobile moderation redesign, clickable review photos, streamlined sign-in feedback, and the latest security remediations. The live demo still serves the previous release. The updated portfolio case study is also a separate review draft.

At implementation commit `acedbfe`, all **322 security tests** passed, along with lint, the production build, and Linux/macOS CI; the dependency audit reported zero vulnerabilities. These results describe that revision and do not certify production. Hosted authorization, Storage, Realtime, delivered recovery email, and remaining device/accessibility checks must finish before rollout. See the [dated release check](docs/security/release-check-2026-09-06.md) for evidence and outstanding work.

## Product features

- **Discover:** browse categories, search listings, view item photos and seller profiles, and save favourites.
- **Sell:** create and edit listings, manage availability, review moderation feedback, and track unique buyer conversations from the dashboard.
- **Message:** listing-linked inboxes with realtime updates, image attachments, reactions, reporting, and per-user hide, restore, and delete controls. Closed listings retain readable conversation history while preventing new messages.
- **Manage an account:** registration and sign-in, password recovery, profile editing, theme preferences, notification preferences, account standing, and password-confirmed account deletion.
- **Moderate:** role-aware listing and report queues, focused review pages with an expandable photo viewer, conversation review, sanctions, user administration, in-app announcements, and an audit trail.
- **Use on mobile:** compact moderation filters, clear status navigation, collapsible review details, and shared image controls across listing and report review.

Registration checks an allowlist of school email domains. This is an eligibility rule, **not proof of enrollment or inbox ownership**. Registered demonstration identities are a separate, restricted exception.

## Run locally

### 1. Prepare the application and database

Use **Node.js 22 and npm**, matching CI. Clone the repository and install the locked dependencies:

```sh
git clone https://github.com/EdoiseO/student-market-of-toronto.git
cd student-market-of-toronto
npm ci
cp .env.example .env.local
```

These commands check out the default branch. To work on the September release described above, check out `agent/redesign-message-media` before installing dependencies.

Use an isolated development Supabase project with the complete application schema, policies, functions, Auth configuration, and Storage setup. **The tracked migrations extend an existing baseline; this repository does not yet provide a standalone empty-project bootstrap.** Creating the few tables named in the UI is insufficient. Obtain the baseline before setting up a new project, then reconcile and apply its pending migrations in order. The native test bootstrap is a synthetic fixture, not a deployable Supabase seed.

An independent project also needs a reviewed target-specific configuration for `private.listing_image_public_url(text)`: the tracked definition contains the original project's Storage origin. Changing `.env.local` alone does not update that database function. Preserve historical migrations and make any required target adaptation explicitly.

The application uses these Storage buckets:

| Bucket | Purpose |
| --- | --- |
| `listing-images` | Listing photos managed through the listing write and cleanup workflows |
| `profile-images` | Profile pictures |
| `message-media` | Private conversation attachments governed by participant and moderation access |

Use the expected bucket policies and upload restrictions; making private message media public is incompatible with the application's access model.

For an existing hosted deployment, read [migration reconciliation and demo identities](docs/security/registered-demo-identities.md) first. Migration `20260906160016_registered_demo_account_emails.sql` is already applied to the shared project and must retain its timestamp and private registry/helper. Do not replay it or blindly repair migration history. Keep operational account mappings and backups outside Git.

### 2. Configure environment variables

Fill in `.env.local` from [.env.example](.env.example):

| Variable | Purpose | Exposure |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL | Browser and server |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY` | Supabase publishable key | Browser and server; database policies still enforce access |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-only Auth administration, recovery intents, trusted account/moderation operations, and workers | Secret; never expose to browser code |
| `CRON_SECRET` | Authenticates scheduled announcement and listing-image cleanup requests | Secret; generate independently of Supabase |

The first three values come from the chosen Supabase project's settings. Generate a separate random `CRON_SECRET`; `.env.local` is ignored by Git. Set the same required variables in the deployment environment when hosting the application.

### 3. Configure authentication

Set the Auth Site URL and allowed redirects for your development origin. Registration uses `/auth/callback`; password recovery uses `/reset-password` with a `state` query parameter. Recovery and signup email templates must respect Supabase's `{{ .ConfirmationURL }}` redirect flow.

Follow [password recovery configuration and verification](docs/password-recovery.md), including the required database migration and redirect matching checks. Recovery must be initiated and completed in the same browser; request another email from the intended browser when switching devices. Reserved demo addresses cannot receive email, so use a controlled inbox in an isolated environment for delivery testing.

### 4. Start the app

```sh
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Missing schema, policies, or server credentials can leave public pages working while protected workflows fail; use the complete development setup above.

## Background workers

Schedule both endpoints at least every five minutes in the deployed environment, using `GET` or `POST` with `Authorization: Bearer <CRON_SECRET>`:

| Endpoint | Work |
| --- | --- |
| `/api/internal/announcements/worker` | Bounded in-app announcement delivery and retry processing |
| `/api/internal/listing-images/cleanup` | Removal of database-leased, unreferenced listing objects and recovery-ledger maintenance |

Both require the server-side service role key. Configure a scheduler that supports the required interval and authorization header; the application does not start a scheduler itself. Use isolated data for development worker runs.

## Checks and tests

```sh
npm run lint
npm run build
REQUIRE_POSTGRES=1 npm run test:security
npm audit
```

The security suite uses Node's test runner and disposable **PostgreSQL 16+** clusters. Install PostgreSQL locally with `postgres`, `initdb`, `pg_ctl`, and `psql` available, or point `POSTGRES_BIN` at their installation directory. No hosted database credentials are required. The fixtures use private Unix sockets with TCP disabled and clean up their own processes and temporary data.

`REQUIRE_POSTGRES=1` makes missing database binaries a failure; without it, local native tests can skip. CI requires them and runs the suite serially on Ubuntu 24.04 and macOS 14 using Node 22. See the [fixture guide](tests/helpers/README.md) and [CI workflow](.github/workflows/security-tests.yml).

After a successful build, `npm run start` serves the production build locally. Local tests do not replace the [isolated hosted authorization checks](docs/security/moderation-authority-staging.md) or actual email delivery verification.

## Architecture and routes

Next.js App Router pages and Route Handlers compose the UI and server workflows. Shared modules implement listing write recovery, message idempotency, moderation, notifications, and media cleanup. PostgreSQL functions, grants, and row-level security enforce data access alongside application checks; a hidden UI control is not an authorization boundary.

| Area | Routes |
| --- | --- |
| Marketplace | `/`, `/search`, `/categories/[slug]`, `/categories/[slug]/all`, `/listings/[slug]` |
| Selling and profiles | `/listings/create`, `/listings/[slug]/edit`, `/profile/[id]`, `/dashboard`, `/dashboard/profile` |
| Conversations | `/messages`, `/messages/[conversationId]` |
| Account and Auth | `/login`, `/register`, `/forget-password`, `/reset-password`, `/auth/callback`, `/dashboard/settings`, `/dashboard/standing`, `/banned` |
| Moderation | `/admin`, `/admin/listings`, `/admin/reports`, `/admin/conversations`, `/admin/enforcement`, `/admin/users`, `/admin/announcements`, `/admin/audit` |

Moderation routes and actions are restricted by current role and account standing. Listing, report, conversation, and user directories have individual detail routes.

```text
src/app/                 Pages, layouts, and Route Handlers
src/components/          Shared UI and feature components
src/lib/                 Domain workflows, validation, and data access
src/utils/supabase/      Browser, server, and session clients
supabase/migrations/     Versioned SQL changes to the application baseline
tests/                   Security and workflow regressions
scripts/                 Isolated hosted verification tools
docs/                    Recovery, remediation, and release documentation
public/                  Static application assets
```

## Implementation notes and documentation

Notification preferences are stored, but they do not by themselves establish a working marketplace email-delivery pipeline. The announcement worker currently supports in-app delivery only; Auth email is configured separately. Seller-sold notification delivery also remains unverified. The [release check](docs/security/release-check-2026-09-06.md) tracks the remaining hosted validation; do not infer deployment status from a passing local build or a preview screenshot.

- [Redesign and security remediation report](docs/remediation-2026-09-06.md): implementation scope, local evidence, and known limits.
- [Password recovery](docs/password-recovery.md): browser binding, configuration, and delivery tests.
- [Hosted moderation checks](docs/security/moderation-authority-staging.md): isolated fixtures and retained-token authorization verification.
- [Registered demo identities](docs/security/registered-demo-identities.md): immutable migration history and login-fixture constraints.
- [Project handoff](HANDOFF.md): dated operational checkpoints; the newest checkpoint takes precedence over historical notes.
