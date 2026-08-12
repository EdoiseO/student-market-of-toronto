import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  buildMessageMediaUploadPlan,
  cleanupExpiredMessageMediaUploads,
  isOwnedMessageMediaStoragePath,
  releaseMessageMediaUploadReservations,
  reserveMessageMediaUploads,
} from "../src/lib/message-media-reservations.mjs";

const reservationMigrationUrl = new URL(
  "../supabase/migrations/20260812112419_enforce_message_media_reservations.sql",
  import.meta.url,
);
const accountDeleteRouteUrl = new URL("../src/app/api/account/delete/route.js", import.meta.url);

test("message-media ownership accepts only exact conversation/user/object paths", () => {
  assert.equal(
    isOwnedMessageMediaStoragePath("conversation/user-id/object.png", "user-id"),
    true,
  );
  assert.equal(
    isOwnedMessageMediaStoragePath("conversation/other-user/object.png", "user-id"),
    false,
  );
  assert.equal(
    isOwnedMessageMediaStoragePath("conversation/user-id/folder/object.png", "user-id"),
    false,
  );
  assert.equal(isOwnedMessageMediaStoragePath("../user-id/object.png", "user-id"), false);
  assert.equal(isOwnedMessageMediaStoragePath("conversation/user-id/..", "user-id"), false);
  assert.equal(
    isOwnedMessageMediaStoragePath("conversation/user-id/%2e%2e", "user-id"),
    false,
  );
  assert.equal(
    isOwnedMessageMediaStoragePath("conversation\\user-id\\object.png", "user-id"),
    false,
  );
});

test("reservation migration serializes Storage inserts and restricts cleanup privileges", async () => {
  const sql = await readFile(reservationMigrationUrl, "utf8");

  assert.match(sql, /before insert on storage\.objects/i);
  assert.ok(
    (sql.match(/perform private\.lock_message_media_user_quota\(/g) ?? []).length >= 5,
    "all quota-changing paths must use the common per-user transaction lock",
  );
  assert.match(sql, /create or replace function public\.prepare_message_media_account_cleanup/i);
  assert.match(sql, /create or replace function public\.retire_message_media_account_reservations/i);
  assert.match(
    sql,
    /grant execute on function public\.prepare_message_media_account_cleanup\(uuid\)\s+to service_role/i,
  );
  assert.match(
    sql,
    /revoke execute on function public\.send_conversation_message_with_attachments\(uuid, text, jsonb\)\s+from service_role/i,
  );
});

test("account deletion strictly retires owned reservations before auth deletion", async () => {
  const source = await readFile(accountDeleteRouteUrl, "utf8");
  const prepareIndex = source.indexOf('admin.rpc("prepare_message_media_account_cleanup"');
  const strictRemoveIndex = source.indexOf("await removeStorageObjectsOrThrow(");
  const retireIndex = source.indexOf('"retire_message_media_account_reservations"');
  const authDeleteIndex = source.indexOf("admin.auth.admin.deleteUser(user.id, true)");

  assert.ok(prepareIndex >= 0);
  assert.ok(strictRemoveIndex > prepareIndex);
  assert.ok(retireIndex > strictRemoveIndex);
  assert.ok(authDeleteIndex > retireIndex);
  assert.match(source, /isOwnedMessageMediaStoragePath\(storagePath, userId\)/);
  assert.match(source, /if \(error\) \{\s+throw error;\s+\}/);
});

test("account deletion verifies attached media is absent before deleting Auth", async () => {
  const source = await readFile(accountDeleteRouteUrl, "utf8");
  const attachedMediaRemove = source.match(
    /await removeStorageObjectsOrThrow\(\s*admin,\s*MESSAGE_MEDIA_RESERVATION_BUCKET,\s*messageMediaPaths,\s*\);/,
  );
  const attachedMediaVerifyIndex = source.indexOf("await verifyStorageObjectsAbsent(");
  const authDeleteIndex = source.indexOf("admin.auth.admin.deleteUser(user.id, true)");

  assert.ok(attachedMediaRemove?.index >= 0);
  assert.ok(attachedMediaVerifyIndex > attachedMediaRemove.index);
  assert.ok(authDeleteIndex > attachedMediaVerifyIndex);
  assert.match(source, /\.list\(folder, \{ limit: 100, offset \}\)/);
  assert.match(
    source,
    /messageMediaPaths\.some\(\s*\(storagePath\) => !isOwnedMessageMediaStoragePath\(storagePath, user\.id\)/,
  );
  assert.doesNotMatch(
    source,
    /removeStorageObjects\(admin, MESSAGE_MEDIA_RESERVATION_BUCKET, messageMediaPaths\)/,
  );
});

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
