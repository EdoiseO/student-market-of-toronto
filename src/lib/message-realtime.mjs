let messageSubscriptionSequence = 0;

function createMessageChannelTopic(conversationId) {
  messageSubscriptionSequence += 1;
  return `conversation-messages-${conversationId}-${messageSubscriptionSequence}`;
}

export function subscribeToConversationMessageInserts({
  supabase,
  conversationId,
  onInsert,
}) {
  if (!supabase || !conversationId || !onInsert) {
    return () => {};
  }

  const channel = supabase
    .channel(createMessageChannelTopic(conversationId))
    .on(
      "postgres_changes",
      {
        event: "INSERT",
        schema: "public",
        table: "messages",
        filter: `conversation_id=eq.${conversationId}`,
      },
      (payload) => onInsert(payload.new),
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
        console.error("Failed to remove conversation message channel:", error);
      });
    }
  };
}
