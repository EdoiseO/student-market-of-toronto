// Callers provide their authenticated client; there is no service-client fallback.
export async function loadReportConversationContext(client, reportId) {
  const { data, error } = await client.rpc("get_report_conversation_context", {
    p_report_id: reportId,
  });

  if (error) {
    throw new Error("The report conversation context is unavailable.", { cause: error });
  }
  if (data === null) return null;

  if (
    !data?.conversation?.id ||
    !Array.isArray(data.messages) ||
    data.messages.length > 5 ||
    data.context_limited !== true ||
    !data.messages.some((message) => message.id === data.reported_message_id)
  ) {
    throw new Error("The report conversation context is invalid.");
  }

  return data;
}
