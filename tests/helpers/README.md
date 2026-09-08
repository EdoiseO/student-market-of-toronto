# Native PostgreSQL fixtures

Use `createPostgresFixture(t)` from `postgres-fixture.mjs` for native database tests.
It registers cleanup before starting PostgreSQL, chooses a private socket directory,
forces UTF-8, and checks the running server's identity and effective isolation.

- `fixture.sql(statement)` returns trimmed stdout and throws on failure.
- `fixture.result(statement, { timeoutMs })` returns the native result for expected failures.
- `fixture.apply(pathOrURL)` executes a local SQL file.
- `fixture.spawnSql(statement, { timeoutMs })` returns a tracked child. Its `completion`
  promise always resolves to `{ status, signal, stdout, stderr, error }`; assert the
  expected status. Omit the statement for an interactive session. Use
  `child.waitForOutput(marker, timeoutMs)` for a bounded, cancellable marker wait.
- `fixture.dispose()` is bounded and idempotent. Explicit `finally` cleanup is useful;
  the registered test hook also handles assertion failures and cancellation.

The default database superuser is `smot_fixture_admin`, independent of the OS account,
so legacy bootstraps may still create their simulated `postgres` role. A bootstrap
that requires `postgres` at initialization can request `{ username: "postgres" }`.
Do not replace role-specific SQL assertions with calls as the fixture superuser.

Native deadlines cover initdb, pg_ctl, and psql. Defaults are 15 seconds for startup
and each shutdown attempt, 30 seconds for clients, 20 seconds for SQL statements,
and 10 seconds for locks. Existing deliberate race delays fit inside these bounds.
The helper terminates tracked clients, attempts fast then immediate shutdown, and
retains the private directory with an error if its postmaster cannot be stopped.
Never delete that retained directory before stopping the owned server.

Clients inherit no operator libpq settings, password/service files, or database URL.
They use explicit socket, port, database, and user options. The socket is private,
TCP listeners are disabled, and every host authentication rule is `reject`.
Assertions connect only through the fixture's own socket. Commas (libpq host-list
separators), line breaks, NUL, and overlong socket paths fail before startup;
use a shorter `TMPDIR` when required. Spaces and shell punctuation are supported.

Install PostgreSQL 16+ locally or set `POSTGRES_BIN` to one installation containing
`postgres`, `initdb`, `pg_ctl`, and `psql`. Local tests skip when binaries are absent;
`REQUIRE_POSTGRES=1` or CI makes absence an error. Run `npm run test:security` to
include the fixture isolation tests, existing SQL scenarios, and all current
migrations. CI uses serial tests on Linux and macOS; no hosted database credentials
are required. Linux/macOS workflow validation still requires an actual CI run.
