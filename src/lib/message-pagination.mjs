export const MESSAGE_PAGE_SIZE = 40;
export const MESSAGE_PAGE_REQUEST_LIMIT = MESSAGE_PAGE_SIZE + 1;
export const MESSAGE_CLIENT_WINDOW_LIMIT = 160;
export const CONVERSATION_INBOX_LIMIT = 100;

function sortMessages(messages) {
  return [...messages].sort((firstMessage, secondMessage) => {
    const createdAtDifference =
      new Date(firstMessage.created_at).getTime() - new Date(secondMessage.created_at).getTime();

    if (createdAtDifference !== 0) {
      return createdAtDifference;
    }

    return String(firstMessage.id).localeCompare(String(secondMessage.id));
  });
}

function mergeUniqueMessages(currentMessages, incomingMessages) {
  const messagesById = new Map(
    (currentMessages ?? []).map((message) => [message.id, message]),
  );

  for (const message of incomingMessages ?? []) {
    messagesById.set(message.id, {
      ...(messagesById.get(message.id) ?? {}),
      ...message,
    });
  }

  return sortMessages(messagesById.values());
}

export function normalizeMessagePageRows(
  newestFirstRows,
  pageSize = MESSAGE_PAGE_SIZE,
) {
  const rows = newestFirstRows ?? [];

  return {
    messages: rows.slice(0, pageSize).reverse(),
    hasOlderMessages: rows.length > pageSize,
  };
}

export function mergeOlderMessageWindow(
  currentMessages,
  olderMessages,
  maxMessages = MESSAGE_CLIENT_WINDOW_LIMIT,
) {
  const mergedMessages = mergeUniqueMessages(currentMessages, olderMessages);
  const droppedNewerMessages = mergedMessages.length > maxMessages;

  return {
    messages: droppedNewerMessages
      ? mergedMessages.slice(0, maxMessages)
      : mergedMessages,
    droppedNewerMessages,
  };
}

export function keepNewestMessageWindow(
  messages,
  maxMessages = MESSAGE_CLIENT_WINDOW_LIMIT,
) {
  const sortedMessages = sortMessages(messages ?? []);
  return sortedMessages.length > maxMessages
    ? sortedMessages.slice(-maxMessages)
    : sortedMessages;
}
