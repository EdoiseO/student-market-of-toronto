import assert from "node:assert/strict";
import test from "node:test";

import { subscribeToConversationMessageInserts } from "../src/lib/message-realtime.mjs";

test("subscribes to inserts for one conversation and removes the channel once", () => {
  const registrations = [];
  const removedChannels = [];
  const channel = {
    on(type, filter, callback) {
      registrations.push({ type, filter, callback });
      return this;
    },
    subscribe() {
      return this;
    },
  };
  const supabase = {
    channel() {
      return channel;
    },
    removeChannel(value) {
      removedChannels.push(value);
      return Promise.resolve();
    },
  };
  const received = [];
  const unsubscribe = subscribeToConversationMessageInserts({
    supabase,
    conversationId: "conversation-1",
    onInsert: (message) => received.push(message),
  });

  assert.equal(registrations.length, 1);
  assert.equal(registrations[0].type, "postgres_changes");
  assert.deepEqual(registrations[0].filter, {
    event: "INSERT",
    schema: "public",
    table: "messages",
    filter: "conversation_id=eq.conversation-1",
  });

  registrations[0].callback({ new: { id: "message-1" } });
  assert.deepEqual(received, [{ id: "message-1" }]);

  unsubscribe();
  unsubscribe();
  assert.deepEqual(removedChannels, [channel]);
});

test("returns a harmless cleanup when required inputs are missing", () => {
  const unsubscribe = subscribeToConversationMessageInserts({});
  assert.doesNotThrow(unsubscribe);
});
