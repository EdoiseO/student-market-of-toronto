let notificationSubscriptionSequence = 0;

function createNotificationChannelTopic(channelName) {
  notificationSubscriptionSequence += 1;
  return `${channelName ?? "notification-updates"}-${notificationSubscriptionSequence}`;
}

export function subscribeToNotificationUpdates({
  supabase,
  userId,
  channelName,
  onChange,
}) {
  if (!supabase || !userId || !onChange) {
    return () => {};
  }

  // Supabase reuses an existing channel when its topic matches. Responsive
  // layouts can mount more than one notification consumer at once, so every
  // subscriber needs its own topic before callbacks are registered.
  const channel = supabase
    .channel(createNotificationChannelTopic(channelName))
    .on(
      "postgres_changes",
      {
        event: "INSERT",
        schema: "public",
        table: "notification_realtime_signals",
        filter: `recipient_user_id=eq.${userId}`,
      },
      onChange,
    )
    .on(
      "postgres_changes",
      {
        event: "UPDATE",
        schema: "public",
        table: "notification_realtime_signals",
        filter: `recipient_user_id=eq.${userId}`,
      },
      onChange,
    )
    .subscribe();

  let isRemoved = false;

  return () => {
    if (isRemoved) {
      return;
    }

    isRemoved = true;
    const removal = supabase.removeChannel(channel);

    if (removal && typeof removal.catch === "function") {
      removal.catch((error) => {
        console.error("Failed to remove notification realtime channel:", error);
      });
    }
  };
}
