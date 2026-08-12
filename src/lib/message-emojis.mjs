export const MESSAGE_COMPOSER_EMOJIS = Object.freeze([
  "😀",
  "😄",
  "😂",
  "🥹",
  "😊",
  "😍",
  "🤩",
  "😎",
  "🤔",
  "😮",
  "😢",
  "😭",
  "😡",
  "👍",
  "👎",
  "👏",
  "🙌",
  "🤝",
  "💯",
  "❤️",
  "🔥",
  "🎉",
  "✨",
  "✅",
]);

export const NATIVE_EMOJI_FONT_FAMILY =
  '"Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", emoji, sans-serif';

function clampSelectionIndex(index, valueLength, fallback) {
  if (!Number.isFinite(index)) {
    return fallback;
  }

  return Math.min(Math.max(Math.trunc(index), 0), valueLength);
}

export function insertMessageEmoji({
  value,
  emoji,
  selectionStart,
  selectionEnd,
  maxLength = 2000,
}) {
  const safeValue = typeof value === "string" ? value : "";
  const safeEmoji = typeof emoji === "string" ? emoji : "";
  const start = clampSelectionIndex(selectionStart, safeValue.length, safeValue.length);
  const end = Math.max(
    start,
    clampSelectionIndex(selectionEnd, safeValue.length, start),
  );
  const nextValue = `${safeValue.slice(0, start)}${safeEmoji}${safeValue.slice(end)}`;

  if (!safeEmoji || nextValue.length > maxLength) {
    return {
      inserted: false,
      value: safeValue,
      selectionStart: start,
      selectionEnd: end,
    };
  }

  const nextCaret = start + safeEmoji.length;

  return {
    inserted: true,
    value: nextValue,
    selectionStart: nextCaret,
    selectionEnd: nextCaret,
  };
}
