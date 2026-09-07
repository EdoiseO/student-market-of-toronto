import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { ESLint } from "eslint";

test("report review page has no unbound runtime identifiers", async () => {
  const file = new URL("../src/app/admin/reports/[reportId]/page.jsx", import.meta.url);
  const eslint = new ESLint({ overrideConfig: { rules: { "no-undef": "error" } } });
  const [result] = await eslint.lintText(await readFile(file, "utf8"), { filePath: fileURLToPath(file) });
  assert.deepEqual(result.messages.filter((message) => message.ruleId === "no-undef" || message.fatal), []);
});
