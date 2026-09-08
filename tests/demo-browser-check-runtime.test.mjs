import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { checkDemoBrowser } from "../scripts/demo-browser-check/checks.mjs";

test("serialized CLI guard works without URL globals and preserves exact-origin/media restrictions", async () => {
  let guard;
  const mainFrame = {};
  const subFrame = { parentFrame: () => mainFrame };
  const page = {
    on() {}, off() {},
    async route(pattern, callback) { guard = callback; }, async unroute() {},
    context: () => ({ async addInitScript() {} }),
    async goto() { throw new Error("END_GUARD_SETUP"); },
    url: () => config.origin + config.publicListingPath, mainFrame: () => mainFrame,
  };
  const config = { origin: "https://fixture.vercel.app", allowedOrigins: ["https://fixture.vercel.app", "https://fixture.supabase.co"],
    deploymentId: "dpl_ObservedPublicDeployment", suppressVercelToolbar: true,
    publicListingPath: "/listings/synthetic-fixture",
    suppressedMapEmbedUrl: "https://www.google.com/maps?q=Synthetic%20campus&z=15&output=embed" };
  // Match the installed CLI's actual execution environment: only page is injected.
  const context = vm.createContext({ page, config });
  assert.equal(vm.runInContext("typeof URL", context), "undefined");
  await assert.rejects(vm.runInContext(`(${checkDemoBrowser.toString()})(page, config, {en:{},fr:{}})`, context), /END_GUARD_SETUP/);
  const request = async (url, method = "GET", body, options = {}) => {
    const route = { request: () => ({ url: () => url, method: () => method, postDataJSON: () => body,
      resourceType: () => options.resourceType ?? "document", isNavigationRequest: () => options.navigation ?? true,
      frame: () => options.frame ?? subFrame }),
      continue: () => "continue", abort: () => "abort", fulfill: () => "fulfilled" };
    return guard(route);
  };
  assert.equal(await request(config.origin + "/admin/listings/example"), "continue");
  assert.equal(await request("https://vercel.live/_next-live/feedback/feedback.js"), "fulfilled");
  assert.equal(await request("https://vercel.live/_next-live/feedback/feedback.js?unexpected=1"), "abort");
  assert.equal(await request("https://vercel.live/_next-live/feedback/other.js"), "abort");
  assert.equal(await request("https://vercel.live/_next-live/feedback/feedback.js", "POST"), "abort");
  const map = config.suppressedMapEmbedUrl;
  assert.equal(await request(map), "fulfilled");
  for (const suffix of ["&extra=1", "#fragment", "&token=secret"]) assert.equal(await request(map + suffix), "abort");
  assert.equal(await request(map.replace("Synthetic%20campus", "Other%20campus")), "abort");
  assert.equal(await request(map, "POST"), "abort");
  assert.equal(await request(map, "GET", undefined, { resourceType: "image" }), "abort");
  assert.equal(await request(map, "GET", undefined, { navigation: false }), "abort");
  assert.equal(await request(map, "GET", undefined, { frame: mainFrame }), "abort");
  assert.equal(await request(map, "GET", undefined, { frame: { parentFrame: () => ({}) } }), "abort");
  delete config.suppressedMapEmbedUrl;
  assert.equal(await request(map), "abort");
  config.suppressedMapEmbedUrl = map;
  const media = config.origin + "/api/message-media/11111111-2222-3333-4444-555555555555";
  assert.equal(await request(media), "continue");
  assert.equal(await request(media + "?dpl=" + config.deploymentId), "continue");
  for (const suffix of ["?dpl=dpl_other", "?token=secret", "?code=secret", "?signature=secret", "?other=value",
    "?dpl=" + config.deploymentId + "&token=secret", "?dpl=" + config.deploymentId + "#fragment", "#fragment", "?"]) {
    assert.equal(await request(media + suffix), "abort", suffix);
  }
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

// Exercise the serialized check's failure decisions without a browser/network.
// This model is not a Radix/component or real-device verification receipt.
async function modeledFullscreenRun({ preventOutside = true, observeOutside = true, zoomWorks = true } = {}) {
  const state = { open: false, zoom: 100, width: 390, height: 844, language: "en", current: "", clicks: [] };
  const openingElement = { __reactProps$fixture: { onClick() {} }, dispose() {} };
  const controlElement = {};
  const outsideListeners = new Set();
  const document = {
    activeElement: openingElement,
    documentElement: {
      get scrollWidth() { return state.width; }, get lang() { return state.language; },
      addEventListener(type, listener) { if (type === "dismissableLayer.pointerDownOutside") outsideListeners.add(listener); },
      removeEventListener(type, listener) { if (type === "dismissableLayer.pointerDownOutside") outsideListeners.delete(listener); },
      dispatchEvent(pointer) {
        if (observeOutside) {
          const event = { detail: { originalEvent: pointer }, defaultPrevented: preventOutside };
          outsideListeners.forEach((listener) => listener(event));
          if (!preventOutside) state.open = false;
        }
      },
    },
    body: { get scrollWidth() { return state.width; } },
  };
  const dialogElement = {
    get isConnected() { return state.open; },
    getAttribute: () => state.open ? "open" : "closed",
    getBoundingClientRect: () => ({ left: 0, top: 0, width: state.width, height: state.open ? state.height : 0 }),
    contains: (element) => element === controlElement,
  };
  const imageElement = { complete: true, naturalWidth: 720 };
  const runtime = vm.createContext({ document, innerWidth: state.width, innerHeight: state.height,
    requestAnimationFrame: (callback) => callback(),
    PointerEvent: class { constructor(type, options) { this.type = type; Object.assign(this, options); this.isTrusted = false; } },
  });
  const evaluate = async (callback, argument) => {
    runtime.argument = argument;
    return vm.runInContext(`(${callback.toString()})(argument)`, runtime);
  };
  const image = { waitFor: async () => {}, first() { return this; },
    evaluate: (callback) => evaluate(callback, imageElement), getAttribute: async () => "/public-fixture.png" };
  const opening = { waitFor: async () => {}, scrollIntoViewIfNeeded: async () => {}, first() { return this; },
    locator: () => image, focus: async () => { document.activeElement = openingElement; },
    elementHandle: async () => openingElement, evaluate: (callback) => evaluate(callback, openingElement) };
  const dialog = {
    waitFor: async ({ state: expected }) => { assert.equal(state.open, expected === "visible"); },
    evaluate: (callback) => evaluate(callback, dialogElement), locator: () => image,
    getByRole: (_, { name }) => ({
      innerText: async () => String(state.zoom) + "%",
      click: async () => {
        assert.equal(state.open, true);
        state.clicks.push(name);
        if (name === "zoom") { if (zoomWorks) state.zoom = 150; }
        else if (name === "reset") state.zoom = 100;
        else { state.open = false; document.activeElement = openingElement; }
      },
    }),
  };
  const page = {
    on() {}, off() {}, route: async () => {}, unroute: async () => {},
    context: () => ({ addInitScript: async () => {}, addCookies: async ([cookie]) => { state.language = cookie.value; } }),
    goto: async (url) => { state.current = url; }, url: () => state.current,
    setViewportSize: async ({ width, height }) => { state.width = width; state.height = height; runtime.innerWidth = width; runtime.innerHeight = height; },
    getByText: () => ({ waitFor: async () => { throw new Error("Recovery is outside this model"); } }),
    getByRole: (role) => role === "dialog" ? dialog : opening,
    evaluate: (callback) => evaluate(callback), waitForFunction: async (callback, argument) => { assert.equal(await evaluate(callback, argument), true); },
    keyboard: { press: async (key) => {
      if (key === "Enter") { state.open = true; state.zoom = 100; document.activeElement = controlElement; }
      else if (key === "Escape") { state.open = false; document.activeElement = openingElement; }
      else document.activeElement = controlElement;
    } },
  };
  const config = { origin: "https://fixture.vercel.app", allowedOrigins: ["https://fixture.vercel.app"],
    listingPath: "/admin/listings/fixture", conversationPath: "/admin/conversations/fixture",
    publicListingPath: "/listings/synthetic-fixture", screenshots: false };
  const t = { adminListingOpenPhoto: "photo", resetImageZoom: "reset", zoomImageIn: "zoom", closeSharedMedia: "close" };
  const report = await checkDemoBrowser(page, config, { en: t, fr: t });
  return { report, clicks: state.clicks, listings: report.cases.filter((item) => item.kind === "listing") };
}

test("fullscreen regression requires outside-hook rejection, subsequent actual zoom, and both explicit close paths", async () => {
  const passing = await modeledFullscreenRun();
  assert.equal(passing.listings.length, 6);
  assert.ok(passing.listings.every((item) => item.result === "PASS"));
  assert.equal(passing.report.injectedOutsidePointerChecks, 12); // shared + public, all locale/width pairs
  assert.equal(passing.clicks.filter((name) => name === "zoom").length, 6);
  assert.equal(passing.clicks.filter((name) => name === "close").length, 6);
  assert.equal(passing.clicks.filter((name) => name === "Close full image").length, 6);

  for (const [options, reason] of [
    [{ preventOutside: false }, "FULLSCREEN_DISMISSED_BY_OUTSIDE_POINTER"],
    [{ observeOutside: false }, "INJECTED_OUTSIDE_POINTER_NOT_EXERCISED"],
    [{ zoomWorks: false }, "ZOOM_DID_NOT_REACH_150"],
  ]) {
    const failed = await modeledFullscreenRun(options);
    assert.ok(failed.listings.every((item) => item.result === "FAIL" && item.reason === reason), reason);
  }
});
