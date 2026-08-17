import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const shell = await readFile(new URL("../src/components/app-layout-shell.jsx", import.meta.url), "utf8");
const page = await readFile(new URL("../src/app/messages/[conversationId]/page.jsx", import.meta.url), "utf8");
const loading = await readFile(new URL("../src/app/messages/[conversationId]/loading.jsx", import.meta.url), "utf8");
const thread = await readFile(new URL("../src/components/messages-thread.jsx", import.meta.url), "utf8");

test("open conversations use the full-height messaging shell", () => {
  assert.match(shell, /isMessagesConversationPage \? null : <SiteHeader/);
  assert.doesNotMatch(page, /max-w-\[1280px\]/);
  assert.doesNotMatch(loading, /max-w-\[1280px\]/);
  assert.match(page, /md:hidden/);
  assert.match(loading, /md:hidden/);
});

test("composer is one compact auto-growing row with conditional feedback", () => {
  assert.match(thread, /className="flex min-w-0 items-end gap-0\.5"/);
  assert.match(thread, /rows=\{1\}/);
  assert.match(thread, /max-h-32/);
  assert.match(thread, /\[field-sizing:content\]/);
  assert.match(thread, /draftCharacterCount >= 1800/);
  assert.match(thread, /messageBodyError \? \(/);
  assert.doesNotMatch(thread, /className="min-h-4 px-2 text-xs text-red-600/);
});
