# Demo browser and device verification

This optional CLI harness exercises the rendered candidate with **synthetic staging fixtures**. It is not a production smoke test, an email-delivery test, a database fixture generator, or proof of real-device behavior. Run it after the demo notice and authenticated private-media gateway changes have been integrated. Do not interpret an unexecuted script as release evidence.

## Prerequisites

- A running local or isolated HTTPS staging deployment of the exact commit in the configuration, with its own Supabase environment and the candidate migrations applied. Confirm the deployed commit independently; the receipt records the supplied SHA and cannot prove the server's build identity.
- A fresh, dedicated Playwright CLI browser session named `smt-demo-qa-*`, opened in a private working directory outside Git. Do not attach a personal browser or reuse a production session. Use an already installed Playwright CLI and browser; this script does not install packages, start a server, open a browser, or sign in.
- Sign in to that session using an approved disposable staging administrator with current authority to read the two fixture detail pages. Keep credentials out of commands, configuration, screenshots, logs, and Git. The session must remain valid during the run. A redirected login/onboarding/standing page fails the check.
- A synthetic listing visible at `/admin/listings/<uuid>` with at least one working public photo, and a synthetic conversation at `/admin/conversations/<uuid>` with an accessible private image and video. Give those two attachments unique filenames. The video must be playable by the selected browser and longer than two seconds. Use innocuous synthetic names, messages and images throughout both pages: screenshots include surrounding UI.
- All fixture images and app dependencies must load from explicitly reviewed `allowedOrigins`. Use staging Storage for the public listing photo. Known production app and Supabase origins are rejected; the operator must also verify that no other supplied origin points at production. HTTPS tests must use valid certificates and same-environment media, not production cookies or signed URLs.
- Private image thumbnails, fullscreen images and the video must use the candidate's same-origin `/api/message-media/<attachment UUID>` gateway. The gateway must support authenticated `Range: bytes=0-0` reads with `206`, an exact one-byte body, `Content-Range`, and `Cache-Control: no-store`. Public listing images retain their normal URL/optimization behavior.
- The detail pages must support read-only navigation without browser-side mutation requests. The harness aborts all browser requests except `GET`/`HEAD` and one locally mocked recovery request. It does not seed media, post messages, mark decisions, change roles, sign out, or send email. Server-side behavior and WebSocket traffic are not a security sandbox; use only the approved synthetic staging environment.

## Run through the existing CLI

Copy `example.json` into the private working directory and replace every placeholder. It contains identifiers and origins only, never passwords, cookies, tokens or signed URLs. Set `screenshots` to `false` if synthetic-only visual content cannot be assured. Keep configuration and outputs outside the repository.

If the deployed Next build appends its public `dpl` identifier to image URLs, set optional `deploymentId` to that exact observed `dpl_…` value. The harness accepts only that single matching parameter; tokens, codes, signatures, other parameters and fragments still fail. On a Vercel preview, optional `suppressVercelToolbar: true` replaces only the exact GET `https://vercel.live/_next-live/feedback/feedback.js` with empty JavaScript and records a separate suppression count. This prevents provider toolbar telemetry from interfering with application checks; it does not ignore application console errors, page errors or unexpected origins.

Set optional `publicListingPath` to the same approved synthetic listing's `/listings/<slug>` page to exercise the separate public photo carousel. Each listing case then also checks its fullscreen outside-pointer policy, explicit Close, Escape and keyboard containment. The public carousel has no app zoom/reset controls; this optional check does not claim opener focus restoration. Without that path, the receipt explicitly marks public-carousel coverage absent.

If that public fixture contains a Google Maps embed, optional `suppressedMapEmbedUrl` may name its **exact observed** `https://www.google.com/maps?q=<encoded synthetic campus>&z=15&output=embed` URL. Only a matching GET document navigation in a direct child frame of the configured public listing page is replaced with empty HTML. Main-frame navigation, other methods/resources, changed queries, fragments and additional parameters retain the default rejection. Google is not added to `allowedOrigins`. The receipt counts `suppressedMapEmbedRequests` and marks Maps and its interactions not covered; this exclusion supports gallery verification only.

Set `QA_CLI` to the entry point of the installed `@playwright/cli` package in your environment. Keep all CLI commands in the same private working directory; session discovery depends on it. The example assumes `QA_CLI`, `QA_REPO` and `QA_OUTPUT` are absolute paths and `QA_SESSION` is a fresh `smt-demo-qa-*` name:

```sh
node "$QA_CLI" -s="$QA_SESSION" open http://localhost:3220/login
node "$QA_CLI" -s="$QA_SESSION" snapshot
```

Authenticate the approved staging fixture privately, then inspect a fresh snapshot to confirm the expected app and identity. Replace the example URL with the isolated HTTPS origin for the HTTPS run. Run:

```sh
node "$QA_REPO/scripts/demo-browser-check/run.mjs" \
  ./browser-config.json "$QA_SESSION" "$QA_CLI" "$QA_OUTPUT"
```

Finally close **only** that disposable CLI session, even after failure:

```sh
node "$QA_CLI" -s="$QA_SESSION" close
```

The harness emits a sanitized `browser-check.json`, plus optional 390-pixel screenshots. It suppresses raw CLI output and records error counts rather than console messages. The CLI may separately create snapshots/logs in its working directory; treat those as private operational artifacts, inspect/redact before sharing, and never commit them. No traces or storage-state exports are needed.

## Automated coverage and interpretation

The 18 cases cover EN/FR at 390, 768 and 1440 CSS pixels (844 pixels high, or 900 at desktop width):

| Surface | Assertions |
| --- | --- |
| Recovery request | Locale-specific demo limitation notice; notice describes the email input; conditional success message after an intercepted synthetic request; document language and no horizontal document/body overflow. The request is fulfilled in the browser and never reaches Auth. |
| Moderation listing | Thumbnail actually loads; keyboard Enter opens the fullscreen viewer; main image loads; injected off-viewport pointer is rejected; an ordinary zoom click reaches 150% and resets; ten Tab presses remain inside the dialog; explicit Close and, after reopening, Escape both close and return focus to the opener; no document overflow. |
| Private attachments | The same image and keyboard checks; private thumbnail/fullscreen/video URL uses the authenticated gateway without query tokens; video metadata loads, controls exist and seeking reaches its target; a separate read-only single-byte request verifies range and cache headers. |

The run also counts console errors, page errors, hydration warnings, unexpected origins, attempted browser mutations and direct private Storage/optimizer requests. A clean run requires all 18 cases and zero counts for those errors. Other console warnings are counted for manual review. Language cookies and localStorage are synchronized before initialization; this establishes clean EN/FR rendering, not the behavior of the interactive language switch.

The pointer regression injects an **untrusted synthetic** mouse `pointerdown` on the HTML element at `(-1,-1)`. It requires Radix's actual outside hook to observe that exact event, prevent dismissal, and leave the same dialog open before the normal control click. This models the sentinel shape observed through iPhone Mirroring; it does not reproduce native trusted input or establish physical Safari correctness. `injectedOutsidePointerChecks` counts successful probes separately.

The harness scrolls lazy media into view, waits up to 15 seconds for the tested React controls' handlers to attach, and waits up to two seconds for the exact opener to regain focus after the dialog closes. These are bounded checks of actual readiness and focus, not fixed sleeps. A missing handler or missing focus restoration still fails. This run exercises the hydrated interface; it does not assess interactions attempted before hydration.

If a fixture is missing, media has an unsupported codec, session authority expires, or a required origin was omitted, record the run as blocked by setup and correct that specific prerequisite. Do not relabel a failed run as passing. For a product failure, retain the sanitized case/reason and inspect the disposable session privately. Fix the candidate, rebuild and repeat only affected checks followed by one complete final-candidate run. Do not relax the assertions to conceal a real failure.

## Actual-device and separate release checklist

Record browser/OS versions, physical device model, candidate SHA, origin, date, result and a nonsecret receipt reference. Mark desktop viewport runs **emulated**. Mark unavailable hardware **not tested**.

1. On a physical iPhone/iPad with Safari and an Android device with Chrome, use the isolated HTTPS app and approved synthetic fixture accounts. Check portrait/landscape, page and sheet scrolling, no sideways page drag, readable EN/FR notice and reachable controls with the on-screen keyboard. Switch the app language in its UI and verify it stays consistent after navigation/reload.
2. Open a public listing photo and private image from their thumbnails. Check close and available photo navigation on the public carousel. On the private/shared viewer, check its zoom/pan, reset and close controls; reopen and verify reset state. Confirm page scrolling is restored after closing. Check controls at larger system text sizes. If a hardware keyboard is available, repeat Enter/Tab/Shift+Tab/Escape and record focus restoration on each surface separately.
3. Play/pause the synthetic private video, seek forward/backward after initial buffering, rotate the device, and return from native fullscreen if offered. Confirm images and video still load over HTTPS and authenticated media is not routed through the public image optimizer. Desktop programmatic seeking does not establish native mobile playback or touch-control behavior.
4. Use VoiceOver/TalkBack where available to check the notice/input relationship, conditional status announcement, image/open/zoom/close names, modal focus containment and video controls. Automated DOM checks do not prove screen-reader speech quality.
5. Keep delivered recovery, same-account cookie clearing, unrelated-session preservation, replay, cache retirement after logout/demotion, Realtime authorization and independent security review as separate existing release gates. The demo deliberately defers custom SMTP, branded sender and general student-inbox delivery; this harness neither sends email nor closes those deferred onboarding prerequisites.

Use only the already authorized disposable-fixture cleanup process when the wider hosted checks finish. This browser harness creates no hosted fixture data to delete.
