"use client";

import * as React from "react";
import { useRouter } from "next/navigation";

import { ConversationListItem } from "@/components/conversation-list-item";
import { subscribeToNotificationUpdates } from "@/lib/notification-realtime.mjs";
import { createClient } from "@/utils/supabase/client";

export function ConversationList({ conversations, currentUserId, label }) {
  const router = useRouter();
  const supabase = React.useMemo(() => createClient(), []);

  React.useEffect(() =>
    subscribeToNotificationUpdates({
      supabase,
      userId: currentUserId,
      channelName: `conversation-moderation-inbox-${currentUserId}`,
      onChange: () => router.refresh(),
    }),
  [currentUserId, router, supabase]);

  return (
    <section aria-label={label}>
      {conversations.map((conversation) => (
        <ConversationListItem
          key={conversation.id}
          conversation={conversation}
          dateValue={conversation.lastMessageAt || conversation.updatedAt}
        />
      ))}
    </section>
  );
}
