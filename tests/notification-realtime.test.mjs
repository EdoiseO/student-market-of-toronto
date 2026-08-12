import assert from "node:assert/strict";
import test from "node:test";

import { subscribeToNotificationUpdates } from "../src/lib/notification-realtime.mjs";

function createSupabaseRealtimeDouble() {
  const channelsByTopic = new Map();
  const removedChannels = [];

  return {
    channelsByTopic,
    removedChannels,
    channel(topic) {
      if (channelsByTopic.has(topic)) {
        return channelsByTopic.get(topic);
      }

      const channel = {
        topic,
        bindings: [],
        subscribed: false,
        on(type, filter, callback) {
          if (this.subscribed) {
            throw new Error(`cannot add \`${type}\` callbacks for realtime:${topic} after \`subscribe()\`.`);
          }

          this.bindings.push({ type, filter, callback });
          return this;
        },
        subscribe() {
          this.subscribed = true;
          return this;
        },
      };

      channelsByTopic.set(topic, channel);
      return channel;
    },
    async removeChannel(channel) {
      removedChannels.push(channel);
      channelsByTopic.delete(channel.topic);
      return "ok";
    },
  };
}

test("notification subscribers use unique topics and register callbacks before subscribing", async () => {
  const supabase = createSupabaseRealtimeDouble();
  const subscriptionOptions = {
    supabase,
    userId: "user-1",
    channelName: "notifications-button-user-1",
    onChange() {},
  };

  const removeFirstSubscription = subscribeToNotificationUpdates(subscriptionOptions);
  const removeSecondSubscription = subscribeToNotificationUpdates(subscriptionOptions);
  const channels = [...supabase.channelsByTopic.values()];

  assert.equal(channels.length, 2);
  assert.notEqual(channels[0].topic, channels[1].topic);
  assert.deepEqual(
    channels.map((channel) => channel.bindings.map((binding) => binding.filter.table)),
    [
      ["notifications", "notification_preferences"],
      ["notifications", "notification_preferences"],
    ],
  );
  assert.ok(channels.every((channel) => channel.subscribed));

  removeFirstSubscription();
  removeFirstSubscription();
  removeSecondSubscription();
  await Promise.resolve();

  assert.equal(supabase.removedChannels.length, 2);
  assert.equal(supabase.channelsByTopic.size, 0);
});
