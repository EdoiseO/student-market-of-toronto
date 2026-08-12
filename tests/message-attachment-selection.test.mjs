import assert from "node:assert/strict";
import test from "node:test";

import {
  getMessageAttachmentFingerprint,
  selectMessageAttachmentFiles,
} from "../src/lib/message-attachment-selection.mjs";

const allowedMimeTypes = new Set(["image/jpeg", "image/png", "video/mp4"]);

function createFile(name, overrides = {}) {
  return {
    name,
    type: "image/jpeg",
    size: 1_024,
    lastModified: 1_723_456_789,
    ...overrides,
  };
}

test("fingerprints include stable file metadata", () => {
  assert.notEqual(
    getMessageAttachmentFingerprint(createFile("photo.jpg")),
    getMessageAttachmentFingerprint(createFile("photo.jpg", { lastModified: 2 })),
  );
});

test("rejects files already selected and duplicates in the incoming batch", () => {
  const existingFile = createFile("existing.jpg");
  const newFile = createFile("new.jpg");
  const result = selectMessageAttachmentFiles({
    files: [existingFile, newFile, newFile],
    currentAttachments: [{ file: existingFile }],
    allowedMimeTypes,
    maxBytes: 10_000,
    maxCount: 3,
  });

  assert.deepEqual(result.acceptedFiles, [newFile]);
  assert.deepEqual(result.duplicateFiles, [existingFile, newFile]);
});

test("filters unsupported and invalid-size files without consuming valid slots", () => {
  const unsupportedFile = createFile("notes.txt", { type: "text/plain" });
  const emptyFile = createFile("empty.png", { type: "image/png", size: 0 });
  const oversizedFile = createFile("large.mp4", { type: "video/mp4", size: 10_001 });
  const validFile = createFile("valid.png", { type: "image/png" });
  const result = selectMessageAttachmentFiles({
    files: [unsupportedFile, emptyFile, oversizedFile, validFile],
    allowedMimeTypes,
    maxBytes: 10_000,
    maxCount: 3,
  });

  assert.deepEqual(result.acceptedFiles, [validFile]);
  assert.deepEqual(result.unsupportedFiles, [unsupportedFile]);
  assert.deepEqual(result.invalidSizeFiles, [emptyFile, oversizedFile]);
  assert.equal(result.limitExceeded, false);
});

test("accepts only the available attachment slots", () => {
  const firstFile = createFile("first.jpg");
  const secondFile = createFile("second.jpg");
  const result = selectMessageAttachmentFiles({
    files: [firstFile, secondFile],
    currentAttachments: [{ file: createFile("existing.jpg") }],
    allowedMimeTypes,
    maxBytes: 10_000,
    maxCount: 2,
  });

  assert.deepEqual(result.acceptedFiles, [firstFile]);
  assert.equal(result.limitExceeded, true);
});
