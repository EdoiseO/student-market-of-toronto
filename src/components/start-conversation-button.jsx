"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { MessageCircle } from "lucide-react";
import { toast } from "sonner";

import { useLanguage } from "@/context/LanguageContext";
import { Button } from "@/components/ui/button";
import { createClient } from "@/utils/supabase/client";

export function StartConversationButton({ listingId, sellerId, currentUserId, className }) {
  const router = useRouter();
  const supabase = React.useMemo(() => createClient(), []);
  const { t } = useLanguage();
  const [isStarting, setIsStarting] = React.useState(false);

  if (!currentUserId) {
    return (
      <Button asChild type="button" className={className}>
        <Link href="/login">
          <MessageCircle className="size-4" />
          <span>{t.signInToMessageSeller}</span>
        </Link>
      </Button>
    );
  }

  if (currentUserId === sellerId) {
    return (
      <Button type="button" disabled className={className}>
        <MessageCircle className="size-4" />
        <span>{t.thisIsYourListing}</span>
      </Button>
    );
  }

  async function handleStartConversation() {
    setIsStarting(true);

    const { data, error } = await supabase.rpc("create_or_get_listing_conversation", {
      p_listing_id: listingId,
    });

    setIsStarting(false);

    if (error) {
      toast.error(t.conversationStartError);
      console.error("Failed to create or load conversation:", error.message);
      return;
    }

    const conversation = Array.isArray(data) ? data[0] : data;

    if (!conversation?.id) {
      toast.error(t.conversationStartError);
      return;
    }

    router.push(`/messages/${conversation.id}`);
  }

  return (
    <Button
      type="button"
      className={className}
      onClick={handleStartConversation}
      disabled={isStarting}
    >
      <MessageCircle className="size-4" />
      <span>{isStarting ? t.startingConversation : t.chatWithSeller}</span>
    </Button>
  );
}
