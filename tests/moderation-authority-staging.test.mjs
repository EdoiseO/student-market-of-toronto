import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

const script = new URL("../scripts/verify-moderation-authority-staging.mjs", import.meta.url);
const run = (extra) => spawnSync(process.execPath, [script.pathname,"verify","/nonexistent/private-fixture.json"], {
  encoding:"utf8",timeout:5000,env:{
    SMOT_STAGING_URL:"https://disposablefixture.supabase.co",
    SMOT_STAGING_ANON_KEY:"unused-fixture-key",
    SMOT_STAGING_SERVICE_ROLE_KEY:"unused-fixture-key",
    ...extra,
  },
});

test("platform harness refuses production even with an explicit acknowledgement", () => {
  const result = run({
    SMOT_STAGING_URL:"https://bmnfynufuqjwjmtlfdxf.supabase.co",
    SMOT_AUTHORITY_STAGING_ACK:"disposable:bmnfynufuqjwjmtlfdxf",
  });
  assert.notEqual(result.status,0);
  assert.match(result.stderr,/The production project is forbidden/);
});

test("platform harness requires acknowledgement bound to the isolated target", () => {
  for (const acknowledgement of [undefined,"disposable:differentproject"]) {
    const result = run(acknowledgement ? {SMOT_AUTHORITY_STAGING_ACK:acknowledgement} : {});
    assert.notEqual(result.status,0);
    assert.match(result.stderr,/Explicitly acknowledge the isolated target/);
  }
});

test("platform harness rejects arbitrary network targets before reading a manifest", () => {
  const result = run({SMOT_STAGING_URL:"https://example.com",SMOT_AUTHORITY_STAGING_ACK:"disposable:local"});
  assert.notEqual(result.status,0);
  assert.match(result.stderr,/Use a disposable Supabase project or local stack/);
});
