import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import {
  chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync,
  rmSync, statSync, writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const binaries = ["postgres", "initdb", "pg_ctl", "psql"];
const candidates = process.env.POSTGRES_BIN ? [process.env.POSTGRES_BIN] : [
  "/opt/homebrew/opt/postgresql@16/bin", "/opt/homebrew/opt/postgresql@17/bin",
  "/usr/local/opt/postgresql@16/bin", "/usr/lib/postgresql/16/bin",
  "/usr/lib/postgresql/17/bin", "/usr/lib/postgresql/18/bin",
];
export const postgresBin = candidates.find((directory) =>
  binaries.every((binary) => existsSync(join(directory, binary))));
export const postgresAvailable = Boolean(postgresBin);
if (!postgresAvailable && (process.env.REQUIRE_POSTGRES === "1" || process.env.CI)) {
  throw new Error("Native PostgreSQL tests require postgres, initdb, pg_ctl and psql; set POSTGRES_BIN.");
}

// pg_ctl -o crosses a POSIX shell boundary; each argv word needs shell quoting.
export const shellWord = (value) => "'" + String(value).replaceAll("'", "'\\''") + "'";
const outputLimit = 2 * 1024 * 1024;
const checkedTimeout = (value) => {
  if (!Number.isInteger(value) || value < 1 || value > 120_000) {
    throw new Error("Fixture timeout must be an integer between 1 and 120000 ms.");
  }
  return value;
};

export function createPostgresFixture(t, {
  prefix = "smot-pg-", username = "smot_fixture_admin", binDirectory = postgresBin,
  startupTimeoutMs = 15_000, queryTimeoutMs = 30_000, shutdownTimeoutMs = 15_000,
} = {}) {
  assert.ok(binDirectory, "PostgreSQL binaries are unavailable");
  assert.match(username, /^[a-z_][a-z0-9_]*$/);
  assert.equal(basename(prefix), prefix, "Fixture prefix must be one path component");
  assert.doesNotMatch(prefix, /[\0\r\n]/);
  for (const timeout of [startupTimeoutMs, queryTimeoutMs, shutdownTimeoutMs]) checkedTimeout(timeout);
  const binaryDirectory = realpathSync(binDirectory);
  const root = realpathSync(mkdtempSync(join(realpathSync(tmpdir()), prefix)));
  chmodSync(root, 0o700);
  const data = join(root, "data");
  const socketDirectory = join(root, "s");
  const logPath = join(root, "postgres.log");
  const passfile = join(root, "pgpass");
  const port = 5432; // Unique private socket directories make a global port allocator unnecessary.
  const children = new Set();
  let disposed = false;
  let initializationAttempted = false;
  const env = {
    PATH: `${binaryDirectory}:/usr/bin:/bin`, HOME: root, LANG: "C", LC_ALL: "C", TZ: "UTC",
    PGPASSFILE: passfile, PGCONNECT_TIMEOUT: "2",
    PGOPTIONS: "-c statement_timeout=20000 -c lock_timeout=10000",
  };
  const psqlArgs = ["-X", "-w", "-qAt", "-h", socketDirectory, "-p", String(port),
    "-U", username, "-d", "postgres", "-v", "ON_ERROR_STOP=1"];

  const commandResult = (name, args, { input, timeoutMs = queryTimeoutMs } = {}) => {
    assert.ok(binaries.includes(name), "Only fixture PostgreSQL binaries may be invoked");
    return spawnSync(join(binaryDirectory, name), args, {
      input, env, cwd: root, encoding: "utf8", maxBuffer: outputLimit,
      timeout: checkedTimeout(timeoutMs), killSignal: "SIGKILL",
    });
  };
  const success = (result, label) => {
    assert.equal(result.error, undefined, `${label}: ${result.error?.message ?? ""}`);
    assert.equal(result.status, 0, `${label}: ${result.stderr || result.stdout}`);
    return result.stdout.trim();
  };
  const result = (statement, options) => {
    assert.ok(!disposed, "PostgreSQL fixture is disposed");
    return commandResult("psql", psqlArgs, { ...options, input: statement });
  };
  const sql = (statement, options) => success(result(statement, options), "psql");
  const apply = (path) => sql(readFileSync(path instanceof URL ? fileURLToPath(path) : path, "utf8"));

  const spawnSql = (statement, { timeoutMs = queryTimeoutMs } = {}) => {
    assert.ok(!disposed, "PostgreSQL fixture is disposed");
    const child = spawn(join(binaryDirectory, "psql"), psqlArgs, {
      env, cwd: root, stdio: ["pipe", "pipe", "pipe"],
      timeout: checkedTimeout(timeoutMs), killSignal: "SIGKILL",
    });
    children.add(child);
    let stdout = "", stderr = "", error, didClose = false;
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    const collect = (kind, chunk) => {
      if (Buffer.byteLength(stdout) + Buffer.byteLength(stderr) + Buffer.byteLength(chunk) > outputLimit) {
        error = new Error("PostgreSQL fixture client output limit exceeded");
        child.kill("SIGKILL");
        return;
      }
      if (kind === "stdout") stdout += chunk;
      else stderr += chunk;
    };
    child.stdout.on("data", (chunk) => collect("stdout", chunk));
    child.stderr.on("data", (chunk) => collect("stderr", chunk));
    child.stdin.on("error", (cause) => { error ??= cause; });
    // Register before returning so callers cannot miss a fast exit or spawn failure.
    child.completion = new Promise((resolveCompletion) => {
      child.on("error", (cause) => { error ??= cause; });
      child.once("close", (status, signal) => {
        didClose = true;
        children.delete(child);
        resolveCompletion({ status, signal, stdout, stderr, error });
      });
    });
    child.waitForOutput = (marker, timeoutMs = 3_000) => new Promise((resolveMarker, reject) => {
      checkedTimeout(timeoutMs);
      let timer;
      const finish = (error) => {
        clearTimeout(timer);
        child.stdout.off("data", check);
        child.off("close", closed);
        if (error) reject(error); else resolveMarker();
      };
      const check = () => { if (stdout.includes(marker)) finish(); };
      const closed = () => finish(new Error(`psql closed before marker ${marker}: ${stderr}`));
      if (stdout.includes(marker)) return resolveMarker();
      if (didClose || child.exitCode !== null || child.signalCode !== null) return closed();
      timer = setTimeout(() => finish(new Error(`Timed out waiting for psql marker ${marker}`)), timeoutMs);
      child.stdout.on("data", check);
      child.once("close", closed);
    });
    if (statement !== undefined) child.stdin.end(statement);
    return child;
  };

  const dispose = () => {
    if (disposed) return;
    for (const child of children) child.kill("SIGKILL");
    if (initializationAttempted && existsSync(join(data, "postmaster.pid"))) {
      for (const mode of ["fast", "immediate"]) {
        const stopped = commandResult("pg_ctl", ["-D", "data", "-m", mode, "-w",
          "-t", String(Math.max(1, Math.ceil(shutdownTimeoutMs / 1000))), "stop"],
        { timeoutMs: Math.min(120_000, shutdownTimeoutMs + 1000) });
        if (stopped.status === 0 && !existsSync(join(data, "postmaster.pid"))) break;
      }
      if (existsSync(join(data, "postmaster.pid")) || existsSync(join(socketDirectory, `.s.PGSQL.${port}`))) {
        throw new Error(`Fixture postmaster did not stop; retained private data at ${root}`);
      }
    }
    rmSync(root, { recursive: true, force: true });
    disposed = true;
  };
  // Register before initdb/start, including failures after the postmaster starts.
  t?.after(dispose);
  try {
    mkdirSync(socketDirectory, { mode: 0o700 });
    writeFileSync(logPath, "", { mode: 0o600 });
    writeFileSync(passfile, "", { mode: 0o600 });
    assert.ok(Buffer.byteLength(join(socketDirectory, `.s.PGSQL.${port}`)) < 104,
      "Fixture Unix socket path is too long; use a shorter TMPDIR/prefix");
    // libpq treats commas in -h as a multi-host list, even inside a Unix path.
    // Reject that representation before starting anything; never fall back to TCP.
    assert.doesNotMatch(socketDirectory, /[,\0\r\n]/, "Socket path cannot contain a libpq host separator");
    initializationAttempted = true;
    success(commandResult("initdb", ["-D", data, "--auth-local=trust", "--auth-host=reject",
      "--no-locale", "--encoding=UTF8", `--username=${username}`],
    { timeoutMs: startupTimeoutMs }), "initdb");
    chmodSync(data, 0o700);
    // unix_socket_directories is itself a PostgreSQL list: double embedded quotes.
    const socketSetting = '"' + socketDirectory.replaceAll('"', '""') + '"';
    const options = ["-c", "listen_addresses=", "-c", "unix_socket_permissions=0700",
      "-c", "wal_level=logical", "-k", socketSetting, "-p", String(port)].map(shellWord).join(" ");
    // pg_ctl also embeds -D/-l in its shell command. Constant relative paths
    // under the native child's cwd keep root-path punctuation out of that layer.
    success(commandResult("pg_ctl", ["-D", "data", "-l", "postgres.log", "-o", options, "-w",
      "-t", String(Math.max(1, Math.ceil(startupTimeoutMs / 1000))), "start"],
    { timeoutMs: Math.min(120_000, startupTimeoutMs + 1000) }), "pg_ctl start");
    for (const path of [root, data, socketDirectory]) {
      const info = statSync(path);
      assert.equal(info.mode & 0o777, 0o700, `Private mode for ${path}`);
      assert.equal(info.uid, process.getuid(), `Owner for ${path}`);
      assert.equal(realpathSync(path), resolve(path));
    }
    const settings = JSON.parse(sql(`select json_build_object(
      'data',current_setting('data_directory'), 'listen',current_setting('listen_addresses'),
      'socket',current_setting('unix_socket_directories'), 'port',current_setting('port'),
      'inet',inet_server_addr(), 'user',session_user);`));
    assert.equal(realpathSync(settings.data), data);
    assert.equal(settings.listen, "", "Disposable PostgreSQL must have no TCP listener");
    assert.equal(settings.socket, socketSetting);
    assert.equal(settings.port, String(port));
    assert.equal(settings.inet, null);
    assert.equal(settings.user, username);
    assert.equal(sql("select count(*) from pg_hba_file_rules where error is not null or (type <> 'local' and auth_method <> 'reject');"), "0");
    assert.ok(Number(sql("select count(*) from pg_hba_file_rules where type <> 'local' and auth_method = 'reject';")) >= 2);
    assert.equal(statSync(join(socketDirectory, `.s.PGSQL.${port}`)).mode & 0o777, 0o700);
    return { root, data, socketDirectory, logPath, port, username, sql, result, apply, spawnSql, dispose };
  } catch (error) {
    try { dispose(); } catch (cleanupError) {
      throw new AggregateError([error, cleanupError], "PostgreSQL fixture startup and cleanup failed");
    }
    throw error;
  }
}
