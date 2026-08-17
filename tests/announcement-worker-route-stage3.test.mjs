import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [route, envExample, readme] = await Promise.all([
  readFile(
    new URL("../src/app/api/internal/announcements/worker/route.js", import.meta.url),
    "utf8",
  ),
  readFile(new URL("../.env.example", import.meta.url), "utf8"),
  readFile(new URL("../README.md", import.meta.url), "utf8"),
]);

test("worker endpoint requires the exact server-only cron bearer", () => {
  assert.match(route, /process\.env\.CRON_SECRET/);
  assert.match(route, /request\.headers\.get\("authorization"\)/);
  assert.match(route, /`Bearer \$\{cronSecret\}`/);
  assert.match(route, /status:\s*401|, 401\)/);
  assert.doesNotMatch(route, /NEXT_PUBLIC_/);
});

test("worker endpoint is independently invokable and bounded by the worker module", () => {
  assert.match(route, /runAnnouncementWorkerPass\(\{ admin \}\)/);
  assert.match(route, /export async function GET/);
  assert.match(route, /export async function POST/);
  assert.match(route, /maxDuration = 60/);
  assert.match(route, /Cache-Control.*no-store/s);
});

test("scheduler secret and activation dependency are documented without a Pro-only config", () => {
  assert.match(envExample, /^CRON_SECRET=$/m);
  assert.match(
    readme,
    /invoke (?:that endpoint|both endpoints) at\s+least every five minutes/i,
  );
  assert.match(
    readme,
    /Vercel Hobby requires a Supabase\s+or other external scheduler/i,
  );
});
