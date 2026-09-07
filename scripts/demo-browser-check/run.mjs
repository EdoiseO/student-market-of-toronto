import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { translations } from "../../src/lib/translations.js";
import { checkDemoBrowser } from "./checks.mjs";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const args = process.argv.slice(2);
if (args.length !== 4) throw new Error("Usage: node run.mjs <config.json> <isolated-session> <playwright-cli.js> <output-directory>");
const [configPath, session, cli, output] = args;
if (!/^smt-demo-qa-[a-z0-9-]+$/.test(session)) throw new Error("Use a dedicated smt-demo-qa-* CLI session, never a personal browser session.");
if (!isAbsolute(cli) || !isAbsolute(output)) throw new Error("CLI and output paths must be absolute.");
const withinRepo = relative(repo, resolve(output));
if (withinRepo !== ".." && !withinRepo.startsWith("../")) throw new Error("Write screenshots/receipts outside the repository.");
const config = JSON.parse(await readFile(configPath, "utf8"));
const origin = new URL(config.origin);
if (origin.origin !== config.origin || !["http:", "https:"].includes(origin.protocol) ||
    (origin.protocol === "http:" && !["localhost", "127.0.0.1"].includes(origin.hostname)) ||
    origin.hostname === "student-market-of-toronto.vercel.app") throw new Error("An isolated local or HTTPS staging origin is required.");
if (config.syntheticFixturesOnly !== true || !/^[0-9a-f]{40}$/i.test(config.candidate || "") || /^0+$/.test(config.candidate)) throw new Error("Confirm synthetic-only fixtures and supply the exact candidate commit.");
for (const [key, route] of [["listingPath", "listings"], ["conversationPath", "conversations"]]) {
  if (!new RegExp(`^/admin/${route}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`, "i").test(config[key] || "")) throw new Error(`Invalid ${key}: use a synthetic admin detail path without query parameters.`);
}
for (const key of ["privateImageName", "privateVideoName"]) {
  if (typeof config[key] !== "string" || !config[key] || /[\r\n]/.test(config[key])) throw new Error(`Missing synthetic ${key}.`);
}
if (config.deploymentId !== undefined && !/^dpl_[A-Za-z0-9]+$/.test(config.deploymentId)) throw new Error("Use the exact observed public Next deployment ID, without URL parameters.");
if (config.suppressVercelToolbar !== undefined && typeof config.suppressVercelToolbar !== "boolean") throw new Error("suppressVercelToolbar must be a boolean.");
if (!Array.isArray(config.allowedOrigins) || !config.allowedOrigins.includes(config.origin) || config.allowedOrigins.some((value) => {
  const url = new URL(value);
  return url.origin !== value || !["http:", "https:"].includes(url.protocol) || url.hostname === "bmnfynufuqjwjmtlfdxf.supabase.co";
})) throw new Error("Use exact reviewed staging/public-fixture origins; production Supabase is forbidden.");
await mkdir(output, { recursive: true, mode: 0o700 });
const labelKeys = ["recoveryDemoNoticeTitle", "recoveryDemoNotice", "sendResetLink", "checkEmailResetLink",
  "adminListingOpenPhoto", "openAttachment", "resetImageZoom", "zoomImageIn"];
const labels = Object.fromEntries(["en", "fr"].map((language) => [language,
  Object.fromEntries(labelKeys.map((key) => [key, translations[language][key]])),
]));
const invoke = (...command) => execFileSync(process.execPath, [cli, `-s=${session}`, ...command], {
  cwd: process.cwd(), encoding: "utf8", timeout: 300_000, maxBuffer: 8 * 1024 * 1024,
});
try {
  // A fresh snapshot is required before interaction. Discard its potentially
  // sensitive text; inspect it manually in the isolated CLI if a selector fails.
  invoke("snapshot");
  const code = `async (page) => { const check = ${checkDemoBrowser.toString()}; return await check(page, ${JSON.stringify({ ...config, outputDirectory: output })}, ${JSON.stringify(labels)}); }`;
  const stdout = invoke("run-code", code);
  const match = stdout.match(/### Result\s*\n([\s\S]*?)(?=\n### |$)/);
  if (!match) throw new Error("No structured CLI result");
  const result = JSON.parse(match[1]);
  await writeFile(resolve(output, "browser-check.json"), JSON.stringify(result, null, 2) + "\n", { mode: 0o600 });
  console.log(JSON.stringify({ result: result.result, cases: result.cases?.length, receipt: resolve(output, "browser-check.json") }));
  if (result.result !== "PASS") process.exitCode = 1;
} catch {
  // Raw CLI output can contain page content/URLs: never echo or retain it.
  console.error("Browser check could not finish. Inspect the named isolated CLI session privately; no raw CLI output was saved.");
  process.exitCode = 1;
}
