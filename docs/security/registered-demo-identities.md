# Registered demo identities: migration integration

The schema migration `20260906160016_registered_demo_account_emails.sql` was already applied to the hosted project on 6 September 2026. This repository now contains the exact applied SQL, with its original timestamp. Its SHA-256 is:

```text
99d9d2e274b8507eb32e58f5eeb841e4d8b0ea8904fab18f8a1cb945b56e87cb
```

This integration contains schema and synthetic tests only. It does not import live registry mappings, operational account records, saved logins, or cleanup backups. Applying the migration to a fresh database creates no demo accounts.

## Read-only reconciliation

The hosted migration history and catalog were inspected read-only on 6 September 2026. They show:

| Version | Migration | Hosted state |
| --- | --- | --- |
| `20260906144154` | `current_moderation_read_authority` | Pending |
| `20260906150000` | `browser_bound_password_recovery` | Pending |
| `20260906160016` | `registered_demo_account_emails` | Applied |

The corresponding moderation helper and recovery table are absent from the hosted catalog. The demo registry and UUID-binding trigger are present. The school helper remains owned by `postgres`, is `STABLE SECURITY DEFINER`, has an empty `search_path`, and retains its Auth execution grant. The private registry has RLS enabled and no client policies; this deliberately denies direct client access.

Three older hosted history entries precede the repository's first tracked migration: `20260811223610`, `20260811224503`, and `20260811225527`. This pre-existing baseline difference was not repaired or replaced. Local history now contains 53 SQL files; hosted history contains 54 entries. The two September pending files account for the remaining local-only entries.

Do not reapply the demo migration, regenerate its timestamp, use the obsolete draft timestamp `20260906155415`, or mark the two pending migrations applied without executing them through an authorized deployment. Inspect the current migration plan before any deployment: the two pending versions are older than the hosted head, and the pre-existing baseline history difference needs deliberate handling. A chronological local reset and an incremental hosted rollout have different execution orders.

## Compatibility contract

Preserve `private.demo_account_identities` and the registry-backed school helper when deploying the pending work. The helper keeps all 15 exact school-domain branches and recognizes a reserved `student-<UUID>@example.com` address only through the private registry for an existing, non-deleted account. The Auth trigger binds an email update to that registered UUID and rejects fresh inserts or another UUID claiming the reserved address.

The helper must remain `STABLE`, because registry changes must be visible to later executions of a prepared statement. It must retain its existing OID, owner, and execution ACL; copying an older domain-only function body would break registered accounts. Do not add a registry policy to silence an informational “RLS enabled, no policy” advisory.

The tests cover both execution orders:

1. Fresh baseline, historical migrations, authorization, recovery, then demo identities.
2. Fresh baseline, historical migrations, the already-live demo migration, then the two older pending migrations.

The second order registers one synthetic existing account before applying the pending pair. It checks the complete school-helper definition, OID, owner, ACL, registry contents, and UUID-binding trigger after each pending migration. Both orders retain the existing full-chain marketplace workflow checks.

Dedicated regressions load the actual tracked school, Auth-email, profile-identity, and trusted profile-writer functions. They cover prepared-plan behavior, all supported domains, wrong-UUID and fresh-signup denial, unchanged synthetic content/ownership, private-table privileges, deleted accounts, mapping constraints, and the expected helper-owner guard. The migration checksum is pinned because an already-applied migration is an immutable record.

Run:

```sh
node --test --test-concurrency=1 tests/registered-demo-identities.test.mjs tests/trusted-writer-cutover-stage6.test.mjs
```

## Login and recovery fixtures

Registered demo addresses have no inbox. They can identify an existing account at password sign-in, but are unsuitable for email delivery or password-recovery delivery verification. Use a dedicated isolated fixture with a controlled inbox for that gate. The existing staging authority harness provisions separate synthetic school-email users and remains isolated from production.

No operational rollback is part of this integration. Never remove the registry or revert its school helper while existing accounts depend on reserved addresses. Any future reversal must first handle those identities through an explicitly authorized operational workflow.
