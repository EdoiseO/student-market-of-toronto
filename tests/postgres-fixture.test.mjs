import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { createPostgresFixture, postgresAvailable, postgresBin, shellWord } from "./helpers/postgres-fixture.mjs";

const native = { skip: !postgresAvailable, timeout: 45_000 };

function assertRemoved(fixture) {
  assert.equal(existsSync(fixture.root), false);
  assert.equal(existsSync(join(fixture.socketDirectory, `.s.PGSQL.${fixture.port}`)), false);
}

// Wrappers affect only binaries in a private fixture directory. They never use a
// configured/default database address or connect to a listening TCP server.
function wrappedBinaries(t, pgCtlBody) {
  const directory = mkdtempSync(join(tmpdir(), "smot-bin-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  for (const binary of ["postgres", "initdb", "psql"]) {
    symlinkSync(join(postgresBin, binary), join(directory, binary));
  }
  writeFileSync(join(directory, "pg_ctl"), `#!/bin/sh\n${typeof pgCtlBody === "function" ? pgCtlBody(directory) : pgCtlBody}\n`, { mode: 0o700 });
  return directory;
}

test("PostgreSQL fixture isolates hostile libpq environment and quotes socket paths", native, (t) => {
  const hostileHome = mkdtempSync(join(tmpdir(), "smot-home-"));
  t.after(() => rmSync(hostileHome, { recursive: true, force: true }));
  const marker = join(hostileHome, "psqlrc-was-read");
  writeFileSync(join(hostileHome, ".psqlrc"), `\\! touch ${shellWord(marker)}\n`);
  const hostile = {
    HOME: hostileHome, PGHOST: "/nonexistent-fixture-socket", PGHOSTADDR: "not-an-ip",
    PGPORT: "1", PGDATABASE: "unrelated", PGUSER: "unrelated", PGPASSWORD: "test-only",
    PGSERVICE: "unrelated", PGSERVICEFILE: join(hostileHome, "missing-service"),
    PGPASSFILE: join(hostileHome, "missing-password"), PSQLRC: join(hostileHome, ".psqlrc"),
    PGOPTIONS: "-c default_transaction_read_only=on", PGSSLMODE: "require",
    PGCLIENTENCODING: "not-an-encoding",
  };
  const original = Object.fromEntries(Object.keys(hostile).map((key) => [key, process.env[key]]));
  let fixture;
  try {
    Object.assign(process.env, hostile);
    fixture = createPostgresFixture(t, { prefix: "p'\" $;`\\-" });
  } finally {
    for (const [key, value] of Object.entries(original)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
  fixture.sql("create table isolated(value text); insert into isolated values ('ok');");
  assert.equal(fixture.sql("select value from isolated;"), "ok");
  assert.equal(fixture.sql("show listen_addresses;"), "");
  assert.equal(fixture.sql("select inet_server_addr() is null;"), "t");
  assert.equal(fixture.sql("select bool_and(auth_method='reject') from pg_hba_file_rules where type <> 'local';"), "t");
  assert.equal(fixture.sql("select bool_and(auth_method='trust') from pg_hba_file_rules where type='local';"), "t");
  for (const path of [fixture.root, fixture.data, fixture.socketDirectory]) {
    assert.equal(statSync(path).mode & 0o777, 0o700);
    assert.equal(statSync(path).uid, process.getuid());
  }
  assert.equal(existsSync(marker), false);
  fixture.dispose();
  fixture.dispose();
  assertRemoved(fixture);
});

test("PostgreSQL fixtures run concurrently without shared state or a port reservation", native, async (t) => {
  const first = createPostgresFixture(t);
  const second = createPostgresFixture(t);
  assert.notEqual(first.socketDirectory, second.socketDirectory);
  assert.equal(first.port, second.port);
  const results = await Promise.all([first, second].map((fixture, index) =>
    fixture.spawnSql(`create table separate(value int); insert into separate values (${index}); select pg_sleep(0.1); select value from separate;`).completion));
  for (const [index, result] of results.entries()) {
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout.trim(), String(index));
  }
  first.dispose();
  assertRemoved(first);
  assert.equal(second.sql("select value from separate;"), "1");
  second.dispose();
  assertRemoved(second);
});

test("PostgreSQL fixture bounds sync/async hangs and cleans live and failed clients", native, async (t) => {
  const fixture = createPostgresFixture(t);
  const started = Date.now();
  const hung = fixture.result("select pg_sleep(60);", { timeoutMs: 100 });
  assert.equal(hung.error?.code, "ETIMEDOUT");
  assert.equal(hung.signal, "SIGKILL");
  assert.ok(Date.now() - started < 5_000);
  const asyncHang = await fixture.spawnSql("select pg_sleep(60);", { timeoutMs: 100 }).completion;
  assert.equal(asyncHang.signal, "SIGKILL");
  const failure = await fixture.spawnSql("select missing_fixture_function();").completion;
  assert.notEqual(failure.status, 0);
  assert.match(failure.stderr, /does not exist/);
  const interactive = fixture.spawnSql();
  interactive.stdin.write("begin; select 'READY';\n");
  await interactive.waitForOutput("READY");
  await assert.rejects(interactive.waitForOutput("NEVER", 25), /Timed out/);
  fixture.dispose();
  assert.equal((await interactive.completion).signal, "SIGKILL");
  assertRemoved(fixture);
});

test("PostgreSQL fixture recovers a startup failure after its postmaster started", native, (t) => {
  const binDirectory = wrappedBinaries(t, (directory) => `
case "$*" in
  *start*) ${shellWord(join(postgresBin, "pg_ctl"))} "$@" || exit "$?"
    printf '%s/%s' "$PWD" "$2" > ${shellWord(join(directory, "data-path"))}
    exit 19 ;;
  *) exec ${shellWord(join(postgresBin, "pg_ctl"))} "$@" ;;
esac`);
  assert.throws(() => createPostgresFixture(t, { binDirectory }), /pg_ctl start/);
  const data = readFileSync(join(binDirectory, "data-path"), "utf8");
  assert.equal(existsSync(data), false);
});

test("PostgreSQL fixture kills a hanging startup controller and stops its owned server", native, async (t) => {
  const binDirectory = wrappedBinaries(t, (directory) => `
case "$*" in
  *start*) ${shellWord(join(postgresBin, "pg_ctl"))} "$@" || exit "$?"
    printf '%s\\n' "$PWD" > ${shellWord(join(directory, "ready-root"))}
    head -n 1 "$2/postmaster.pid" > ${shellWord(join(directory, "ready-pid"))}
    while :; do :; done ;;
  *) exec ${shellWord(join(postgresBin, "pg_ctl"))} "$@" ;;
esac`);
  let registeredCleanup;
  try {
    assert.throws(() => createPostgresFixture({ after: (cleanup) => { registeredCleanup = cleanup; } },
      { binDirectory, startupTimeoutMs: 1_000 }), (error) => {
      assert.match(error.message, /pg_ctl start:.*ETIMEDOUT/s);
      assert.equal(error.actual?.code, "ETIMEDOUT");
      return true;
    });
    // Prove initdb and the real server started before the injected controller hang.
    const readyRoot = join(binDirectory, "ready-root");
    const root = readFileSync(readyRoot, "utf8").trim();
    const pid = Number(readFileSync(join(binDirectory, "ready-pid"), "utf8").trim());
    assert.ok(Number.isSafeInteger(pid) && pid > 0);
    assert.ok(Date.now() - statSync(readyRoot).mtimeMs < 7_000);
    // The PID file can disappear just before the process exits and is reaped.
    const exitDeadline = Date.now() + 2_000;
    while (true) {
      try { process.kill(pid, 0); } catch (error) {
        assert.equal(error.code, "ESRCH");
        break;
      }
      assert.ok(Date.now() < exitDeadline, "Owned postmaster did not exit");
      await delay(20);
    }
    assertRemoved({ root, socketDirectory: join(root, "s"), port: 5432 });
    assert.doesNotThrow(registeredCleanup);
  } finally {
    // Retry even on assertion failure, while the private controller still exists.
    registeredCleanup?.();
  }
});

test("PostgreSQL fixture gives initialization an independent timeout", native, (t) => {
  const binDirectory = wrappedBinaries(t, `exec ${shellWord(join(postgresBin, "pg_ctl"))} "$@"`);
  rmSync(join(binDirectory, "initdb"));
  // Deterministically exceed the controller's one-second budget before initdb.
  writeFileSync(join(binDirectory, "initdb"), `#!/bin/sh\nsleep 2\nexec ${shellWord(join(postgresBin, "initdb"))} "$@"\n`, { mode: 0o700 });
  let registeredCleanup;
  try {
    const fixture = createPostgresFixture({ after: (cleanup) => { registeredCleanup = cleanup; } },
      { binDirectory, startupTimeoutMs: 1_000 });
    assert.equal(fixture.sql("select 1;"), "1");
    fixture.dispose();
    assertRemoved(fixture);
  } finally {
    registeredCleanup?.();
  }
});

test("PostgreSQL fixture retains private data when stopping fails, then allows cleanup retry", native, (t) => {
  const binDirectory = wrappedBinaries(t, `
case "$*" in
  *stop*) exit 23 ;;
  *) exec ${shellWord(join(postgresBin, "pg_ctl"))} "$@" ;;
esac`);
  const fixture = createPostgresFixture(t, { binDirectory });
  assert.throws(() => fixture.dispose(), /retained private data/);
  assert.equal(existsSync(join(fixture.data, "postmaster.pid")), true);
  assert.equal(statSync(fixture.root).mode & 0o777, 0o700);
  // Restore this fixture's controller so the owned instance can be stopped.
  writeFileSync(join(binDirectory, "pg_ctl"), `#!/bin/sh\nexec ${shellWord(join(postgresBin, "pg_ctl"))} "$@"\n`, { mode: 0o700 });
  fixture.dispose();
  assertRemoved(fixture);
});

test("PostgreSQL fixture bounds a hanging fast shutdown and falls back to immediate", native, (t) => {
  const binDirectory = wrappedBinaries(t, `
case "$*" in
  *fast*) while :; do :; done ;;
  *) exec ${shellWord(join(postgresBin, "pg_ctl"))} "$@" ;;
esac`);
  const fixture = createPostgresFixture(t, { binDirectory, shutdownTimeoutMs: 100 });
  const started = Date.now();
  fixture.dispose();
  assert.ok(Date.now() - started < 5_000);
  assertRemoved(fixture);
});

test("PostgreSQL fixture rejects multi-host and overlong socket representations before startup", native, (t) => {
  const cleanup = [];
  const context = { after: (hook) => cleanup.push(hook) };
  assert.throws(() => createPostgresFixture(context, { prefix: "comma,-" }), /libpq host separator/);
  assert.throws(() => createPostgresFixture(context, { prefix: "long".repeat(30) }), /too long/);
  for (const hook of cleanup) assert.doesNotThrow(hook);
  t.after(() => cleanup.forEach((hook) => hook()));
});

test("PostgreSQL fixture test hooks clean up assertion failures and cancelled tests", native, (t) => {
  const directory = mkdtempSync(join(tmpdir(), "smot-cancel-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  for (const mode of ["failure", "cancel"]) {
    const rootFile = join(directory, mode);
    const source = `
      import test from 'node:test';
      import { writeFileSync } from 'node:fs';
      import { createPostgresFixture } from ${JSON.stringify(new URL("./helpers/postgres-fixture.mjs", import.meta.url).href)};
      test('owned fixture ${mode}', { timeout: 100 }, async (t) => {
        const fixture = createPostgresFixture(t);
        writeFileSync(${JSON.stringify(rootFile)}, fixture.root);
        ${mode === "failure" ? "fixture.sql('select missing_fixture_function();');" : "await fixture.spawnSql('select pg_sleep(60);').completion;"}
      });`;
    const child = spawnSync(process.execPath, ["--input-type=module", "-e", source], {
      encoding: "utf8", env: { PATH: process.env.PATH, POSTGRES_BIN: postgresBin },
      timeout: 10_000, killSignal: "SIGKILL", maxBuffer: 1024 * 1024,
    });
    assert.equal(child.error, undefined, child.error?.message);
    assert.equal(child.status, 1, child.stderr || child.stdout);
    assert.equal(existsSync(readFileSync(rootFile, "utf8")), false);
  }
});

test("native PostgreSQL CI mode fails instead of silently skipping missing binaries", () => {
  const probe = spawnSync(process.execPath, ["--input-type=module", "-e",
    `await import(${JSON.stringify(new URL("./helpers/postgres-fixture.mjs", import.meta.url).href)});`], {
    encoding: "utf8", env: { PATH: process.env.PATH, POSTGRES_BIN: "/nonexistent-postgres-bin", REQUIRE_POSTGRES: "1" },
    timeout: 5_000,
  });
  assert.notEqual(probe.status, 0);
  assert.match(probe.stderr, /Native PostgreSQL tests require/);
});
