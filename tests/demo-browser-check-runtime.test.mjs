import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { checkDemoBrowser } from "../scripts/demo-browser-check/checks.mjs";

test("serialized CLI guard works without URL globals and preserves exact-origin/media restrictions", async () => {
  let guard;
  const page = {
    on() {}, off() {},
    async route(pattern, callback) { guard = callback; }, async unroute() {},
    context: () => ({ async addInitScript() {} }),
    async goto() { throw new Error("END_GUARD_SETUP"); },
  };
  const config = { origin: "https://fixture.vercel.app", allowedOrigins: ["https://fixture.vercel.app", "https://fixture.supabase.co"] };
  // Match the installed CLI's actual execution environment: only page is injected.
  const context = vm.createContext({ page, config });
  assert.equal(vm.runInContext("typeof URL", context), "undefined");
  await assert.rejects(vm.runInContext(`(${checkDemoBrowser.toString()})(page, config, {en:{},fr:{}})`, context), /END_GUARD_SETUP/);
  const request = async (url, method = "GET", body) => {
    const route = { request: () => ({ url: () => url, method: () => method, postDataJSON: () => body }),
      continue: () => "continue", abort: () => "abort", fulfill: () => "fulfilled" };
    return guard(route);
  };
  assert.equal(await request(config.origin + "/admin/listings/example"), "continue");
  assert.equal(await request(config.origin + ".evil.test/admin"), "abort");
  assert.equal(await request("https://fixture.vercel.app@evil.test/admin"), "abort");
  assert.equal(await request(config.origin + "/api/decisions", "POST"), "abort");
  assert.equal(await request(config.origin + "/api/auth/recovery", "POST", { action: "request", email: "browser-fixture@example.invalid" }), "fulfilled");
  assert.equal(await request(config.origin + "/api/auth/recovery", "POST", { action: "request", email: "other@example.invalid" }), "abort");
  assert.equal(await request("https://fixture.supabase.co/storage/v1/object/authenticated/message-media/fixture"), "abort");
  assert.equal(await request(config.origin + "/_next/image?url=%2Fapi%2Fmessage-media%2Ffixture&w=64&q=75"), "abort");
  assert.equal(await request(config.origin + "/_next/image?url=%ZZ"), "abort");
  assert.equal(await request(config.origin + "/_next/image?url=https%3A%2F%2Ffixture.supabase.co%2Fstorage%2Fv1%2Fobject%2Fpublic%2Flisting-images%2Ffixture"), "continue");
});
