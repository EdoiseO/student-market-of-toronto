// Serialized into the existing Playwright CLI's run-code command. Keep helpers
// inside this function: the CLI process does not share this module's imports.
export async function checkDemoBrowser(page, config, labels) {
  const report = {
    scope: "Desktop Playwright viewport emulation; synthetic staging fixtures only",
    candidate: config.candidate, cases: [], screenshots: [],
    consoleErrors: 0, consoleWarnings: 0, hydrationWarnings: 0, pageErrors: 0,
    blockedMutations: 0, blockedOrigins: 0, directPrivateRequests: 0,
    mockedRecoveryRequests: 0,
  };
  const require = (condition, code) => { if (!condition) throw new Error(`CHECK:${code}`); };
  const onConsole = (message) => {
    if (message.type() === "error") report.consoleErrors++;
    if (message.type() === "warning") report.consoleWarnings++;
    if (/hydrat|server rendered|did not match|didn't match/i.test(message.text())) report.hydrationWarnings++;
  };
  const onError = () => { report.pageErrors++; };
  page.on("console", onConsole);
  page.on("pageerror", onError);
  const guard = async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin === config.origin && url.pathname === "/api/auth/recovery" && request.method() === "POST") {
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
    if (!config.allowedOrigins.includes(url.origin)) {
      report.blockedOrigins++;
      return route.abort("blockedbyclient");
    }
    const optimizedSource = url.pathname === "/_next/image" ? url.searchParams.get("url") || "" : "";
    if (/\/storage\/v1\/(?:object|render\/image)\/(?:sign|authenticated)\/message-media\//.test(url.pathname) ||
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
    const url = new URL(value, config.origin);
    require(url.origin === config.origin && /^\/api\/message-media\/[0-9a-f-]+$/i.test(url.pathname) &&
      !url.search && !url.hash, "PRIVATE_MEDIA_NOT_USING_GATEWAY");
    return url.toString();
  };
  const capture = async (name, width) => {
    if (!config.screenshots || width !== 390) return;
    const file = `${name}.png`;
    await page.screenshot({ path: `${config.outputDirectory}/${file}` });
    report.screenshots.push(file);
  };
  const navigate = async (path) => {
    await page.goto(config.origin + path, { waitUntil: "domcontentloaded", timeout: 30000 });
    require(new URL(page.url()).pathname === path, "UNEXPECTED_REDIRECT_OR_MISSING_SESSION");
  };
  const imageDialog = async (opening, t, privateImage, screenshotName, width) => {
    await opening.waitFor({ state: "visible", timeout: 15000 });
    await loaded(opening.locator("img"));
    if (privateImage) gateway(await opening.locator("img").getAttribute("src"));
    await opening.focus();
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog");
    await dialog.waitFor({ state: "visible" });
    require(await dialog.evaluate((element) => {
      const bounds = element.getBoundingClientRect();
      return Math.abs(bounds.left) <= 1 && Math.abs(bounds.top) <= 1 &&
        Math.abs(bounds.width - innerWidth) <= 1 && Math.abs(bounds.height - innerHeight) <= 1;
    }), "VIEWER_NOT_FULLSCREEN");
    const image = dialog.locator('img[alt]:not([alt=""])').first();
    await loaded(image);
    if (privateImage) gateway(await image.getAttribute("src"));
    const reset = dialog.getByRole("button", { name: t.resetImageZoom, exact: true });
    const before = parseInt(await reset.innerText(), 10);
    await dialog.getByRole("button", { name: t.zoomImageIn, exact: true }).click();
    require(parseInt(await reset.innerText(), 10) > before, "ZOOM_DID_NOT_INCREASE");
    await measure();
    await reset.click();
    require(parseInt(await reset.innerText(), 10) === before, "ZOOM_DID_NOT_RESET");
    // Exercise Radix's actual keyboard containment and close-focus restoration.
    for (let step = 0; step < 10; step++) {
      await page.keyboard.press("Tab");
      require(await dialog.evaluate((element) => element.contains(document.activeElement)), "FOCUS_ESCAPED_DIALOG");
    }
    await page.keyboard.press("Shift+Tab");
    require(await dialog.evaluate((element) => element.contains(document.activeElement)), "REVERSE_FOCUS_ESCAPED_DIALOG");
    await measure();
    await capture(screenshotName, width);
    await page.keyboard.press("Escape");
    await dialog.waitFor({ state: "hidden" });
    require(await opening.evaluate((element) => element === document.activeElement), "FOCUS_NOT_RESTORED");
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
          try {
            if (kind === "recovery") {
              await navigate("/forget-password");
              await page.getByText(t.recoveryDemoNoticeTitle, { exact: true }).waitFor();
              require(await page.locator("#recovery-demo-notice").innerText() === t.recoveryDemoNotice, "DEMO_NOTICE_LOCALE_MISMATCH");
              require(await page.locator("#email").getAttribute("aria-describedby") === "recovery-demo-notice", "NOTICE_NOT_DESCRIBING_EMAIL");
              await page.locator("#email").fill("browser-fixture@example.invalid");
              await page.getByRole("button", { name: t.sendResetLink, exact: true }).click();
              await page.getByRole("status").filter({ hasText: t.checkEmailResetLink }).waitFor();
              item.response = "mocked-request-only; no recovery email or session exchange";
              await capture(`${language}-recovery-notice`, width);
            } else if (kind === "listing") {
              await navigate(config.listingPath);
              const opening = page.getByRole("button", { name: new RegExp(`^${t.adminListingOpenPhoto}:`) }).first();
              await imageDialog(opening, t, false, `${language}-listing-viewer`, width);
            } else {
              await navigate(config.conversationPath);
              const opening = page.getByRole("button", { name: `${t.openAttachment}: ${config.privateImageName}`, exact: true });
              await imageDialog(opening, t, true, `${language}-private-viewer`, width);
              const video = page.getByLabel(config.privateVideoName, { exact: true });
              await video.waitFor({ state: "visible", timeout: 15000 });
              await page.waitForFunction((name) => {
                const video = [...document.querySelectorAll("video")].find((element) => element.getAttribute("aria-label") === name);
                return video && video.readyState >= 1 && Number.isFinite(video.duration) && video.duration > 2;
              }, config.privateVideoName, { timeout: 15000 });
              const videoUrl = gateway(await video.evaluate((element) => element.currentSrc));
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
  return report;
}
