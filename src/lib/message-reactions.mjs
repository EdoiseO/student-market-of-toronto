export const MESSAGE_REACTION_OPTIONS = Object.freeze(["👍", "❤️", "😂", "😮", "😢", "🎉"]);

let reactionSubscriptionSequence = 0;

function reactionKey(reaction) {
  return `${reaction.message_id}:${reaction.user_id}:${reaction.emoji}`;
}

function createReactionChannelTopic(conversationId) {
  reactionSubscriptionSequence += 1;
  return `message-reactions-${conversationId}-${reactionSubscriptionSequence}`;
}

export function addMessageReaction(messages, reaction) {
  if (!reaction?.message_id || !reaction?.user_id || !reaction?.emoji) {
    return messages;
  }

  return messages.map((message) => {
    if (message.id !== reaction.message_id) {
      return message;
    }

    const reactions = message.reactions ?? [];
    const key = reactionKey(reaction);
    const existingIndex = reactions.findIndex((item) => reactionKey(item) === key);

    if (existingIndex === -1) {
      return { ...message, reactions: [...reactions, reaction] };
    }

    const nextReactions = [...reactions];
    nextReactions[existingIndex] = { ...reactions[existingIndex], ...reaction };
    return { ...message, reactions: nextReactions };
  });
}

export function applyMessageReactionChange(messages, reaction) {
  return reaction?.removed_at
    ? removeMessageReaction(messages, reaction)
    : addMessageReaction(messages, reaction);
}

export function removeMessageReaction(messages, reaction) {
  if (!reaction?.message_id || !reaction?.user_id || !reaction?.emoji) {
    return messages;
  }

  const key = reactionKey(reaction);

  return messages.map((message) =>
    message.id === reaction.message_id
      ? {
          ...message,
          reactions: (message.reactions ?? []).filter((item) => reactionKey(item) !== key),
        }
      : message,
  );
}

export function replaceMessageReactions(messages, reactions) {
  const reactionsByMessageId = (reactions ?? []).reduce((result, reaction) => {
    result[reaction.message_id] ??= [];
    result[reaction.message_id].push(reaction);
    return result;
  }, {});

  return messages.map((message) => ({
    ...message,
    reactions: reactionsByMessageId[message.id] ?? [],
  }));
}

export function groupMessageReactions(reactions, currentUserId) {
  const groupsByEmoji = new Map();

  for (const reaction of reactions ?? []) {
    const currentGroup = groupsByEmoji.get(reaction.emoji) ?? {
      emoji: reaction.emoji,
      count: 0,
      reactedByCurrentUser: false,
    };

    currentGroup.count += 1;
    currentGroup.reactedByCurrentUser ||= reaction.user_id === currentUserId;
    groupsByEmoji.set(reaction.emoji, currentGroup);
  }

  return MESSAGE_REACTION_OPTIONS.flatMap((emoji) => {
    const group = groupsByEmoji.get(emoji);
    return group ? [group] : [];
  });
}

export function countAdditionalMessageReactions(groups) {
  return (groups ?? []).reduce(
    (total, group) => total + Math.max(0, Number(group?.count ?? 0) - 1),
    0,
  );
}

export function subscribeToMessageReactionUpdates({
  supabase,
  conversationId,
  onInsert,
  onUpdate,
}) {
  if (!supabase || !conversationId || !onInsert || !onUpdate) {
    return () => {};
  }

  const channel = supabase
    .channel(createReactionChannelTopic(conversationId))
    .on(
      "postgres_changes",
      {
        event: "INSERT",
        schema: "public",
        table: "message_reactions",
        filter: `conversation_id=eq.${conversationId}`,
      },
      (payload) => onInsert(payload.new),
    )
    .on(
      "postgres_changes",
      {
        event: "UPDATE",
        schema: "public",
        table: "message_reactions",
        filter: `conversation_id=eq.${conversationId}`,
      },
      (payload) => onUpdate(payload.new),
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
        console.error("Failed to remove message reaction realtime channel:", error);
      });
    }
  };
}
