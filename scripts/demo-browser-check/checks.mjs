// Serialized into the existing Playwright CLI's run-code command. Keep helpers
// inside this function: the CLI process does not share this module's imports.
export async function checkDemoBrowser(page, config, labels) {
  const report = {
    scope: "Desktop Playwright viewport emulation; synthetic staging fixtures only",
    candidate: config.candidate, cases: [], screenshots: [],
    consoleErrors: 0, consoleWarnings: 0, hydrationWarnings: 0, pageErrors: 0,
    pageErrorDetails: [],
    blockedMutations: 0, blockedOrigins: 0, directPrivateRequests: 0,
    mockedRecoveryRequests: 0, suppressedDeploymentToolbarRequests: 0,
    suppressedMapEmbedRequests: 0,
    injectedOutsidePointerChecks: 0,
    injectedOutsidePointerAttempts: [],
  };
  const require = (condition, code) => { if (!condition) throw new Error(`CHECK:${code}`); };
  // The CLI executes this function in a VM without Node's URL global. Requests
  // already carry browser-canonical absolute URLs; match exact origin boundaries.
  const belongsTo = (value, origin) => value === origin || value.startsWith(origin + "/");
  const pathname = (value, origin) => value.slice(origin.length).split(/[?#]/, 1)[0] || "/";
  const isGatewayUrl = (value) => {
    if (!belongsTo(value, config.origin)) return false;
    const relative = value.slice(config.origin.length);
    const queryAt = relative.indexOf("?");
    const path = queryAt < 0 ? relative : relative.slice(0, queryAt);
    const query = queryAt < 0 ? "" : relative.slice(queryAt);
    return /^\/api\/message-media\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(path) &&
      (!query || (config.deploymentId && query === `?dpl=${config.deploymentId}`));
  };
  const queryValue = (value, key) => {
    const query = value.includes("?") ? value.slice(value.indexOf("?") + 1).split("#", 1)[0] : "";
    for (const part of query.split("&")) {
      const equals = part.indexOf("=");
      const name = equals < 0 ? part : part.slice(0, equals);
      if (decodeURIComponent(name.replace(/\+/g, " ")) === key) {
        return decodeURIComponent((equals < 0 ? "" : part.slice(equals + 1)).replace(/\+/g, " "));
      }
    }
    return "";
  };
  const onConsole = (message) => {
    if (message.type() === "error") report.consoleErrors++;
    if (message.type() === "warning") report.consoleWarnings++;
    if (/hydrat|server rendered|did not match|didn't match/i.test(message.text())) report.hydrationWarnings++;
  };
  const onError = (error) => {
    report.pageErrors++;
    const hydration = /Minified React error #418\b|hydrat|server rendered|did not match|didn't match/i.test(error.message);
    if (hydration) report.hydrationWarnings++;
    const current = page.url();
    const surface = current === config.origin + config.listingPath ? "listing" :
      current === config.origin + config.conversationPath ? "private-media" :
        current === config.origin + "/forget-password" ? "recovery" : "other";
    if (report.pageErrorDetails.length < 64) report.pageErrorDetails.push({ surface, kind: hydration ? "hydration" : "unclassified" });
  };
  page.on("console", onConsole);
  page.on("pageerror", onError);
  const guard = async (route) => {
    const request = route.request();
    const url = request.url();
    // Optional preview-only instrumentation: suppress this exact provider script
    // before it loads telemetry. Never ignore application console/page errors.
    if (config.suppressVercelToolbar && request.method() === "GET" &&
        url === "https://vercel.live/_next-live/feedback/feedback.js") {
      report.suppressedDeploymentToolbarRequests++;
      return route.fulfill({ status: 200, contentType: "application/javascript", body: "" });
    }
    // Optional gallery-only exclusion: one reviewed synthetic listing iframe.
    // Never allow Google's origin, main-frame navigation, or map subresources.
    if (config.suppressedMapEmbedUrl && url === config.suppressedMapEmbedUrl &&
        page.url() === config.origin + config.publicListingPath && request.method() === "GET" &&
        request.resourceType() === "document" && request.isNavigationRequest() &&
        request.frame() !== page.mainFrame() && request.frame().parentFrame() === page.mainFrame()) {
      report.suppressedMapEmbedRequests++;
      return route.fulfill({ status: 200, contentType: "text/html", body: "<!doctype html><title>Map excluded from gallery verification</title>" });
    }
    const origin = config.allowedOrigins.find((allowed) => belongsTo(url, allowed));
    const path = origin ? pathname(url, origin) : "";
    if (origin === config.origin && path === "/api/auth/recovery" && request.method() === "POST") {
      const body = request.postDataJSON();
      if (body?.action === "request" && body.email === "browser-fixture@example.invalid") {
        report.mockedRecoveryRequests++;
        return route.fulfill({ status: 200, contentType: "application/json", body: '{"sent":true}' });
      }
    }
    if (!["GET", "HEAD"].includes(request.method())) {
      report.blockedMutations++;
      return route.abort("blockedbyclient");
    }
    if (!origin) {
      report.blockedOrigins++;
      return route.abort("blockedbyclient");
    }
    let optimizedSource = "";
    try { optimizedSource = path === "/_next/image" ? queryValue(url, "url") : ""; }
    catch { report.blockedOrigins++; return route.abort("blockedbyclient"); }
    if ((origin === config.origin && path.startsWith("/api/message-media/") && !isGatewayUrl(url)) ||
        /\/storage\/v1\/(?:object|render\/image)\/(?:sign|authenticated)\/message-media\//.test(path) ||
        /(?:\/api\/message-media\/|\/message-media\/)/.test(optimizedSource)) {
      report.directPrivateRequests++;
      return route.abort("blockedbyclient");
    }
    return route.continue();
  };
  await page.route("**/*", guard);
  // Synchronize the existing app's two locale stores before React initializes.
  await page.context().addInitScript(({ origin }) => {
    if (location.origin !== origin) return;
    const language = document.cookie.split("; ").find((part) => part.startsWith("language="))?.split("=")[1];
    if (language === "en" || language === "fr") localStorage.setItem("language", language);
  }, { origin: config.origin });
  const measure = async () => {
    const result = await page.evaluate(() => ({
      width: innerWidth, documentWidth: document.documentElement.scrollWidth,
      bodyWidth: document.body.scrollWidth, language: document.documentElement.lang,
    }));
    require(result.documentWidth <= result.width + 1 && result.bodyWidth <= result.width + 1, "HORIZONTAL_OVERFLOW");
    return result;
  };
  const loaded = async (image) => {
    await image.waitFor({ state: "visible", timeout: 15000 });
    await image.evaluate((element) => element.complete && element.naturalWidth > 0
      ? undefined
      : new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("Image load timeout")), 10000);
        element.addEventListener("load", () => { clearTimeout(timer); resolve(); }, { once: true });
        element.addEventListener("error", () => { clearTimeout(timer); reject(new Error("Image failed")); }, { once: true });
      }));
    require(await image.evaluate((element) => element.naturalWidth > 0), "IMAGE_NOT_LOADED");
  };
  const gateway = (value) => {
    const url = value.startsWith("/") ? config.origin + value : value;
    require(isGatewayUrl(url), "PRIVATE_MEDIA_NOT_USING_GATEWAY");
    return url;
  };
  const capture = async (name, width) => {
    if (!config.screenshots || width !== 390) return;
    const file = `${name}.png`;
    await page.screenshot({ path: `${config.outputDirectory}/${file}` });
    report.screenshots.push(file);
  };
  const navigate = async (path) => {
    await page.goto(config.origin + path, { waitUntil: "domcontentloaded", timeout: 30000 });
    require(page.url() === config.origin + path, "UNEXPECTED_REDIRECT_OR_MISSING_SESSION");
  };
  // Server HTML is already visible before React attaches event handlers. Wait
  // for the exact control's handler rather than a network-idle heuristic.
  const hydrated = async (control, handler) => {
    const element = await control.elementHandle();
    try {
      await page.waitForFunction(({ element, handler }) => element && Object.keys(element).some((key) =>
        key.startsWith("__reactProps$") && typeof element[key]?.[handler] === "function"),
      { element, handler }, { timeout: 15000 });
    } finally { await element?.dispose(); }
  };
  let phase = "setup";
  const imageDialog = async (opening, t, privateImage, screenshotName, width, options = {}) => {
    const zoomable = options.zoomable !== false;
    const restoreFocus = options.restoreFocus !== false;
    phase = "thumbnail-readiness";
    await opening.waitFor({ state: "visible", timeout: 15000 });
    await opening.scrollIntoViewIfNeeded();
    await loaded(opening.locator("img"));
    if (privateImage) gateway(await opening.locator("img").getAttribute("src"));
    await hydrated(opening, "onClick");
    await opening.focus();
    await page.keyboard.press("Enter");
    phase = "dialog-open";
    const dialog = page.getByRole("dialog");
    await dialog.waitFor({ state: "visible" });
    require(await dialog.evaluate((element) => {
      const bounds = element.getBoundingClientRect();
      return Math.abs(bounds.left) <= 1 && Math.abs(bounds.top) <= 1 &&
        Math.abs(bounds.width - innerWidth) <= 1 && Math.abs(bounds.height - innerHeight) <= 1;
    }), "VIEWER_NOT_FULLSCREEN");
    const image = dialog.locator('img[alt]:not([alt=""])').first();
    phase = "dialog-image-load";
    await loaded(image);
    if (privateImage) gateway(await image.getAttribute("src"));
    // Model the observed iPhone Mirroring sentinel without claiming native input:
    // dispatch on html, outside the fullscreen content, then use a real control.
    // Require Radix's actual outside hook to run so missing listeners cannot pass.
    phase = "dialog-injected-outside-pointer";
    // The installed Radix listener is registered by an effect plus a zero-delay
    // task. Let the opening render paint before the one injected pointer; cached
    // images can otherwise complete before that listener exists.
    await dialog.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const injected = await dialog.evaluate((element) => new Promise((resolve) => {
      const pointer = new PointerEvent("pointerdown", {
        bubbles: true, composed: true, cancelable: true,
        pointerType: "mouse", isPrimary: true, button: 0, buttons: 1, clientX: -1, clientY: -1,
      });
      let outside;
      const observe = (event) => { if (event.detail?.originalEvent === pointer) outside = event; };
      document.documentElement.addEventListener("dismissableLayer.pointerDownOutside", observe);
      document.documentElement.dispatchEvent(pointer);
      requestAnimationFrame(() => requestAnimationFrame(() => {
        document.documentElement.removeEventListener("dismissableLayer.pointerDownOutside", observe);
        resolve({
          isTrusted: pointer.isTrusted, outsideObserved: Boolean(outside),
          outsidePrevented: outside?.defaultPrevented === true,
          sameDialogOpen: element.isConnected && element.getAttribute("data-state") === "open" && element.getBoundingClientRect().height > 0,
        });
      }));
    }));
    report.injectedOutsidePointerAttempts.push({ surface: screenshotName, width, ...injected });
    require(injected.isTrusted === false && injected.outsideObserved, "INJECTED_OUTSIDE_POINTER_NOT_EXERCISED");
    require(injected.outsidePrevented && injected.sameDialogOpen, "FULLSCREEN_DISMISSED_BY_OUTSIDE_POINTER");
    report.injectedOutsidePointerChecks++;
    if (zoomable) {
      const reset = dialog.getByRole("button", { name: t.resetImageZoom, exact: true });
      phase = "dialog-zoom-after-injected-pointer";
      require(parseInt(await reset.innerText(), 10) === 100, "INITIAL_ZOOM_NOT_RESET");
      await dialog.getByRole("button", { name: t.zoomImageIn, exact: true }).click();
      require(parseInt(await reset.innerText(), 10) === 150, "ZOOM_DID_NOT_REACH_150");
      await measure();
      await reset.click();
      require(parseInt(await reset.innerText(), 10) === 100, "ZOOM_DID_NOT_RESET");
    }
    // Exercise Radix's actual keyboard containment and close-focus restoration.
    phase = "dialog-focus-containment";
    for (let step = 0; step < 10; step++) {
      await page.keyboard.press("Tab");
      require(await dialog.evaluate((element) => element.contains(document.activeElement)), "FOCUS_ESCAPED_DIALOG");
    }
    await page.keyboard.press("Shift+Tab");
    require(await dialog.evaluate((element) => element.contains(document.activeElement)), "REVERSE_FOCUS_ESCAPED_DIALOG");
    await measure();
    await capture(screenshotName, width);
    const closed = async () => {
      await dialog.waitFor({ state: "hidden" });
      if (!restoreFocus) return;
      // Radix restores focus after the closing transition. Require the opener.
      const opener = await opening.elementHandle();
      try {
        await page.waitForFunction((element) => element === document.activeElement, opener, { timeout: 2000 });
      } finally { await opener?.dispose(); }
      require(await opening.evaluate((element) => element === document.activeElement), "FOCUS_NOT_RESTORED");
    };
    phase = "dialog-explicit-close-focus";
    await dialog.getByRole("button", { name: options.closeLabel || t.closeSharedMedia, exact: true }).click();
    await closed();
    await opening.focus();
    await page.keyboard.press("Enter");
    await dialog.waitFor({ state: "visible" });
    phase = "dialog-escape-close-focus";
    await page.keyboard.press("Escape");
    await closed();
  };
  try {
    for (const language of ["en", "fr"]) {
      const t = labels[language];
      await page.goto("about:blank");
      await page.context().addCookies([{ name: "language", value: language, url: config.origin + "/", sameSite: "Lax" }]);
      for (const width of [390, 768, 1440]) {
        await page.setViewportSize({ width, height: width === 1440 ? 900 : 844 });
        for (const kind of ["recovery", "listing", "private-media"]) {
          const item = { language, width, kind, result: "NOT_RUN" };
          phase = "navigation";
          try {
            if (kind === "recovery") {
              await navigate("/forget-password");
              phase = "recovery-request";
              await page.getByText(t.recoveryDemoNoticeTitle, { exact: true }).waitFor();
              require(await page.locator("#recovery-demo-notice").innerText() === t.recoveryDemoNotice, "DEMO_NOTICE_LOCALE_MISMATCH");
              require(await page.locator("#email").getAttribute("aria-describedby") === "recovery-demo-notice", "NOTICE_NOT_DESCRIBING_EMAIL");
              await hydrated(page.locator("#email"), "onChange");
              await hydrated(page.locator("form"), "onSubmit");
              await page.locator("#email").fill("browser-fixture@example.invalid");
              await page.getByRole("button", { name: t.sendResetLink, exact: true }).click();
              await page.getByRole("status").filter({ hasText: t.checkEmailResetLink }).waitFor();
              item.response = "mocked-request-only; no recovery email or session exchange";
              await capture(`${language}-recovery-notice`, width);
            } else if (kind === "listing") {
              await navigate(config.listingPath);
              const opening = page.getByRole("button", { name: new RegExp(`^${t.adminListingOpenPhoto}:`) }).first();
              await imageDialog(opening, t, false, `${language}-listing-viewer`, width);
              item.injectedOutsidePointer = "synthetic mouse/html/-1,-1; shared viewer remains open and actual zoom reaches 150%";
              if (config.publicListingPath) {
                await navigate(config.publicListingPath);
                const publicOpening = page.getByRole("button", { name: /^View .+ photo 1 full size$/ }).first();
                await imageDialog(publicOpening, t, false, `${language}-public-listing-viewer`, width,
                  { zoomable: false, closeLabel: "Close full image", restoreFocus: false });
                item.publicListingViewer = "injected outside pointer rejected; explicit Close, Escape and focus containment passed; no app zoom control";
              }
            } else {
              await navigate(config.conversationPath);
              const opening = page.getByRole("button", { name: `${t.openAttachment}: ${config.privateImageName}`, exact: true });
              await imageDialog(opening, t, true, `${language}-private-viewer`, width);
              item.injectedOutsidePointer = "synthetic mouse/html/-1,-1; private viewer remains open and actual zoom reaches 150%";
              phase = "video-metadata";
              const video = page.getByLabel(config.privateVideoName, { exact: true });
              await video.waitFor({ state: "visible", timeout: 15000 });
              await video.scrollIntoViewIfNeeded();
              await page.waitForFunction((name) => {
                const video = [...document.querySelectorAll("video")].find((element) => element.getAttribute("aria-label") === name);
                return video && video.readyState >= 1 && Number.isFinite(video.duration) && video.duration > 2;
              }, config.privateVideoName, { timeout: 15000 });
              const videoUrl = gateway(await video.evaluate((element) => element.currentSrc));
              phase = "video-seek";
              const seeking = await video.evaluate(async (element) => {
                const target = element.duration / 2;
                await new Promise((resolve, reject) => {
                  const timer = setTimeout(() => reject(new Error("Seek timeout")), 10000);
                  element.addEventListener("seeked", () => { clearTimeout(timer); resolve(); }, { once: true });
                  element.currentTime = target;
                });
                return { target, actual: element.currentTime, controls: element.controls };
              });
              require(seeking.controls && Math.abs(seeking.actual - seeking.target) < 0.5, "VIDEO_SEEK_FAILED");
              // This supplements actual element seeking; it does not claim the
              // browser necessarily needed a new range after buffering the clip.
              phase = "video-range";
              const ranged = await page.request.get(videoUrl, { headers: { Range: "bytes=0-0" }, maxRedirects: 0 });
              try {
                require(ranged.status() === 206, "GATEWAY_SINGLE_BYTE_RANGE_STATUS");
                require(/^bytes 0-0\/\d+$/.test(ranged.headers()["content-range"] || ""), "GATEWAY_RANGE_HEADER");
                require((await ranged.body()).length === 1, "GATEWAY_RANGE_LENGTH");
                require(/no-store/i.test(ranged.headers()["cache-control"] || ""), "PRIVATE_RESPONSE_CACHEABLE");
              } finally { await ranged.dispose(); }
              item.videoSeek = true;
              item.singleByteRange = true;
            }
            item.layout = await measure();
            require(item.layout.language === language, "DOCUMENT_LANGUAGE_MISMATCH");
            item.result = "PASS";
          } catch (error) {
            item.result = "FAIL";
            item.phase = phase;
            item.reason = error.message.startsWith("CHECK:") ? error.message.slice(6) : "BROWSER_ACTION_FAILED_INSPECT_PRIVATE_SESSION";
          }
          report.cases.push(item);
        }
      }
    }
  } finally {
    await page.unroute("**/*", guard);
    page.off("console", onConsole);
    page.off("pageerror", onError);
  }
  report.result = report.cases.length === 18 && report.cases.every((item) => item.result === "PASS") &&
    !report.consoleErrors && !report.pageErrors && !report.hydrationWarnings && !report.blockedOrigins &&
    !report.blockedMutations && !report.directPrivateRequests ? "PASS" : "FAIL";
  report.notCovered = ["real iOS/Android devices", "screen-reader speech and touch gestures",
    "delivered recovery email, hosted password changes or session revocation", "retained-token demotion/cache retirement", "Realtime authorization"];
  if (!config.publicListingPath) report.notCovered.push("public ListingPhotoCarousel outside-pointer policy (no publicListingPath supplied)");
  else report.notCovered.push("public ListingPhotoCarousel opener focus restoration; it has no existing restoration contract in this harness");
  if (config.suppressedMapEmbedUrl) report.notCovered.push("Google Maps iframe and map interactions (exact configured embed replaced locally)");
  return report;
}
