import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import test from "node:test";
import { formatModerationDateTime } from "../src/lib/moderation-date-time.mjs";

const dates = ["2026-01-15T03:00:00Z", "2026-07-15T03:00:00Z"];

test("moderation timestamps match across server and browser default timezones", () => {
  const moduleUrl = new URL("../src/lib/moderation-date-time.mjs", import.meta.url).href;
  const script = `import { formatModerationDateTime as format } from ${JSON.stringify(moduleUrl)};
    console.log(JSON.stringify(${JSON.stringify(dates)}.map(date => [format(date, "en"), format(date, "fr")])));`;
  const results = ["UTC", "America/Toronto", "Asia/Tokyo"].map((timeZone) => JSON.parse(execFileSync(
    process.execPath, ["--input-type=module", "--eval", script],
    { env: { ...process.env, TZ: timeZone }, encoding: "utf8", timeout: 5000, maxBuffer: 16384 },
  )));
  assert.deepEqual(results[0], results[1]);
  assert.deepEqual(results[0], results[2]);
});

test("Toronto display preserves localized dates, midnight rollover and daylight saving", () => {
  // These UTC-valued clock readings independently state the expected Toronto
  // wall time: UTC-5 in January and UTC-4 in July, both on the previous day.
  const torontoClock = ["2026-01-14T22:00:00Z", "2026-07-14T23:00:00Z"];
  for (const language of ["en", "fr"]) {
    const expected = new Intl.DateTimeFormat(`${language}-CA`, {
      dateStyle: "medium", timeStyle: "short", timeZone: "UTC",
    });
    for (let index = 0; index < dates.length; index++) {
      assert.equal(formatModerationDateTime(dates[index], language), expected.format(new Date(torontoClock[index])));
    }
  }
  assert.notEqual(formatModerationDateTime(dates[0], "en"), formatModerationDateTime(dates[0], "fr"));
  assert.equal(formatModerationDateTime(null, "en"), "—");
  assert.equal(formatModerationDateTime("", "fr"), "—");
});
