import assert from "node:assert/strict";
import test from "node:test";

import {
  buildMessageMediaUploadPlan,
  cleanupExpiredMessageMediaUploads,
  releaseMessageMediaUploadReservations,
  reserveMessageMediaUploads,
} from "../src/lib/message-media-reservations.mjs";

test("buildMessageMediaUploadPlan binds each file to an exact user and conversation path", () => {
  const ids = ["first-id", "second-id"];
  const plan = buildMessageMediaUploadPlan({
    attachments: [
      { id: "one", file: { name: "one photo.png", type: "image/png", size: 123 } },
      { id: "two", file: { name: "clip.webm", type: "video/webm", size: 456 } },
    ],
    conversationId: "conversation-id",
    userId: "user-id",
    randomUUID: () => ids.shift(),
    sanitizeFileName: (name) => name.replaceAll(" ", "-"),
  });

  assert.deepEqual(
    plan.map(({ storagePath, payload }) => ({ storagePath, payload })),
    [
      {
        storagePath: "conversation-id/user-id/first-id-one-photo.png",
        payload: {
          storage_path: "conversation-id/user-id/first-id-one-photo.png",
          file_name: "one-photo.png",
          mime_type: "image/png",
          size_bytes: 123,
        },
      },
      {
        storagePath: "conversation-id/user-id/second-id-clip.webm",
        payload: {
          storage_path: "conversation-id/user-id/second-id-clip.webm",
          file_name: "clip.webm",
          mime_type: "video/webm",
          size_bytes: 456,
        },
      },
    ],
  );
});

test("releaseMessageMediaUploadReservations deduplicates paths and skips empty requests", async () => {
  const calls = [];
  const supabase = {
    rpc: async (...args) => {
      calls.push(args);
      return { data: 2, error: null };
    },
  };

  assert.deepEqual(await releaseMessageMediaUploadReservations(supabase, []), {
    data: 0,
    error: null,
  });
  await releaseMessageMediaUploadReservations(supabase, ["one", "one", null, "two"]);

  assert.deepEqual(calls, [
    ["release_message_media_upload_reservations", { p_storage_paths: ["one", "two"] }],
  ]);
});

test("reserveMessageMediaUploads sends exact planned metadata to the database", async () => {
  const calls = [];
  const supabase = {
    rpc: async (...args) => {
      calls.push(args);
      return { data: [{ storage_path: "conversation/user/object" }], error: null };
    },
  };
  const plan = [
    {
      storagePath: "conversation/user/object",
      payload: {
        storage_path: "conversation/user/object",
        file_name: "photo.png",
        mime_type: "image/png",
        size_bytes: 123,
      },
    },
  ];

  await reserveMessageMediaUploads(supabase, "conversation", plan);

  assert.deepEqual(calls, [
    [
      "reserve_message_media_uploads",
      { p_conversation_id: "conversation", p_attachments: [plan[0].payload] },
    ],
  ]);
});

test("cleanup removes expired objects through Storage before releasing reservations", async () => {
  const events = [];
  const supabase = {
    rpc: async (name, args) => {
      events.push(["rpc", name, args]);
      if (name === "list_expired_message_media_uploads") {
        return { data: [{ storage_path: "old/path" }], error: null };
      }
      return { data: 1, error: null };
    },
    storage: {
      from: (bucket) => ({
        remove: async (paths) => {
          events.push(["remove", bucket, paths]);
          return { error: null };
        },
      }),
    },
  };

  const result = await cleanupExpiredMessageMediaUploads(supabase);

  assert.deepEqual(result, { error: null, removedPaths: ["old/path"] });
  assert.deepEqual(events, [
    ["rpc", "list_expired_message_media_uploads", undefined],
    ["remove", "message-media", ["old/path"]],
    ["rpc", "release_message_media_upload_reservations", { p_storage_paths: ["old/path"] }],
  ]);
});

test("cleanup never releases a reservation when Storage removal fails", async () => {
  const rpcCalls = [];
  const removeError = new Error("storage unavailable");
  const supabase = {
    rpc: async (name) => {
      rpcCalls.push(name);
      return { data: [{ storage_path: "old/path" }], error: null };
    },
    storage: {
      from: () => ({ remove: async () => ({ error: removeError }) }),
    },
  };

  assert.deepEqual(await cleanupExpiredMessageMediaUploads(supabase), {
    error: removeError,
    removedPaths: [],
  });
  assert.deepEqual(rpcCalls, ["list_expired_message_media_uploads"]);
});
