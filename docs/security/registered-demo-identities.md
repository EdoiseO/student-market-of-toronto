# Registered demo identities

`20260906160016_registered_demo_account_emails.sql` is the exact previously applied migration. Preserve its original timestamp and SQL. Its pinned SHA-256 is:

```text
99d9d2e274b8507eb32e58f5eeb841e4d8b0ea8904fab18f8a1cb945b56e87cb
```

The repository contains schema and synthetic tests, not live registry mappings or account records. Applying this migration to a fresh database creates no demo accounts. Do not reapply it to a database whose history already records it, regenerate its timestamp, or use the obsolete draft version `20260906155415`.

## Identity contract

- Preserve `private.demo_account_identities` and the registry-backed school helper. All 15 exact school-domain branches remain supported. A reserved `student-<UUID>@example.com` address is valid only through the private registry for an existing, non-deleted account.
- The Auth trigger binds email updates to the registered UUID. It rejects fresh inserts and another UUID claiming the reserved address.
- The school helper must remain `STABLE SECURITY DEFINER`, owned by `postgres`, with an empty `search_path`. Preserve its OID, execution ACL and Auth grant. `STABLE` permits registry changes to become visible to later executions of a prepared statement; restoring an older domain-only body would break registered accounts.
- The private registry has RLS enabled and no client policies. This intentionally denies direct client access; do not add a policy to silence an informational advisory.

## Migration compatibility

Reconcile actual target history and catalog state before deployment; follow the [deployment guide](../deployment.md). Three hosted baseline versions predate the repository's first tracked migration: `20260811223610`, `20260811224503` and `20260811225527`. Do not repair that difference blindly or mark SQL applied without executing it.

A chronological fresh setup and an incremental rollout can have different execution orders. The tests cover both chronological application and the already-applied demo migration followed by the older `20260906144154` authorization and `20260906150000` recovery migrations. The latter registers one synthetic existing identity first, then verifies the complete helper definition, OID, owner, ACL, registry and UUID trigger after each migration.

With the [native PostgreSQL prerequisites](../../tests/helpers/README.md) installed, run:

```sh
REQUIRE_POSTGRES=1 node --test --test-concurrency=1 tests/registered-demo-identities.test.mjs tests/trusted-writer-cutover-stage6.test.mjs
```

The regressions also cover prepared statements, supported domains, wrong-UUID and fresh-signup denial, deleted accounts, private-table privileges, mapping constraints, ownership preservation and the immutable migration checksum.

## Login and recovery

Registered demo addresses have no inbox. They can identify an existing account at password sign-in but cannot verify email or password-recovery delivery. Use a separate isolated fixture with a controlled inbox; never add a general email-domain exception for a test account. See the [recovery guide](../password-recovery.md) for the demo sender limitations.

Do not remove the registry or revert its helper while accounts depend on these addresses. Any future reversal must first handle the affected identities through an explicitly authorized operational workflow. Keep account mappings and operational backups outside Git.
