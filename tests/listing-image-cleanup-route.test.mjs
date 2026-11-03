import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [route, envExample, readme] = await Promise.all([
  readFile(
    new URL(
      "../src/app/api/internal/listing-images/cleanup/route.js",
      import.meta.url,
    ),
    "utf8",
  ),
  readFile(new URL("../.env.example", import.meta.url), "utf8"),
  readFile(new URL("../README.md", import.meta.url), "utf8"),
]);

test("listing cleanup route requires the exact server-only cron bearer", () => {
  assert.match(route, /process\.env\.CRON_SECRET/);
  assert.match(route, /request\.headers\.get\("authorization"\)/);
  assert.match(route, /`Bearer \$\{cronSecret\}`/);
  assert.match(route, /status:\s*401|, 401\)/);
  assert.doesNotMatch(route, /NEXT_PUBLIC_/);
});

test("listing cleanup route is bounded, uncached, and independently invokable", () => {
  assert.match(route, /runListingImageCleanupWorkerPass\(\{ admin \}\)/);
  assert.match(route, /export async function GET/);
  assert.match(route, /export async function POST/);
  assert.match(route, /maxDuration = 60/);
  assert.match(route, /Cache-Control.*no-store/s);
});

test("the existing secret documents both independently scheduled workers", () => {
  assert.match(envExample, /^CRON_SECRET=$/m);
  assert.match(readme, /\/api\/internal\/announcements\/worker/);
  assert.match(readme, /\/api\/internal\/listing-images\/cleanup/);
  assert.match(readme, /at\s+least every five minutes/i);
});
