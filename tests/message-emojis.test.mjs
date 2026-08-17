import assert from "node:assert/strict";
import test from "node:test";

import {
  MESSAGE_COMPOSER_EMOJIS,
  NATIVE_EMOJI_FONT_FAMILY,
  insertMessageEmoji,
} from "../src/lib/message-emojis.mjs";

test("composer emoji options are native Unicode strings rather than image assets", () => {
  assert.equal(MESSAGE_COMPOSER_EMOJIS.length, 24);
  assert.equal(new Set(MESSAGE_COMPOSER_EMOJIS).size, MESSAGE_COMPOSER_EMOJIS.length);
  assert.ok(MESSAGE_COMPOSER_EMOJIS.every((emoji) => !emoji.includes("/") && !emoji.includes(":")));
  assert.match(NATIVE_EMOJI_FONT_FAMILY, /Apple Color Emoji/);
  assert.match(NATIVE_EMOJI_FONT_FAMILY, /Segoe UI Emoji/);
});

test("inserts an emoji at the textarea caret and advances by its UTF-16 length", () => {
  const result = insertMessageEmoji({
    value: "Hello there",
    emoji: "😀",
    selectionStart: 5,
    selectionEnd: 5,
  });

  assert.deepEqual(result, {
    inserted: true,
    value: "Hello😀 there",
    selectionStart: 7,
    selectionEnd: 7,
  });
});

test("replaces the active textarea selection", () => {
  const result = insertMessageEmoji({
    value: "That is great",
    emoji: "🔥",
    selectionStart: 8,
    selectionEnd: 13,
  });

  assert.equal(result.value, "That is 🔥");
  assert.equal(result.selectionStart, 10);
  assert.equal(result.selectionEnd, 10);
});

test("counts emoji as one code point at the message character limit", () => {
  const result = insertMessageEmoji({
    value: "1234",
    emoji: "😀",
    selectionStart: 4,
    selectionEnd: 4,
    maxLength: 5,
  });

  assert.equal(result.inserted, true);
  assert.equal(result.value, "1234😀");

  const overLimit = insertMessageEmoji({
    value: "😀".repeat(5),
    emoji: "😀",
    selectionStart: 10,
    selectionEnd: 10,
    maxLength: 5,
  });
  assert.equal(overLimit.inserted, false);
});

test("clamps stale selection positions to the current message", () => {
  const result = insertMessageEmoji({
    value: "Hi",
    emoji: "🎉",
    selectionStart: 99,
    selectionEnd: 120,
  });

  assert.equal(result.value, "Hi🎉");
  assert.equal(result.selectionStart, 4);
});
