"use client";

import * as React from "react";
import { Megaphone } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { useLanguage } from "@/context/LanguageContext";
import {
  ANNOUNCEMENT_MESSAGE_MAX_LENGTH,
  validateAnnouncementMessage,
} from "@/lib/moderation-policy.mjs";

export function AdminAnnouncementSheet() {
  const { t } = useLanguage();
  const [isOpen, setIsOpen] = React.useState(false);
  const [message, setMessage] = React.useState("");
  const [isSending, setIsSending] = React.useState(false);
  const operationIdRef = React.useRef(null);

  async function handleSend(event) {
    event.preventDefault();

    const validatedMessage = validateAnnouncementMessage(message);

    if (!validatedMessage.ok || isSending) {
      if (!isSending) {
        toast.error(t.announcementMessageValidationError ?? t.announcementError);
      }
      return;
    }

    setIsSending(true);

    try {
      operationIdRef.current ??= crypto.randomUUID();
      const response = await fetch("/api/admin/announcements", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: validatedMessage.message,
          operationId: operationIdRef.current,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data?.error ?? "Unknown error");
      }

      if (data?.noRecipients) {
        toast.error(t.announcementNoRecipients);
        setIsSending(false);
        return;
      }

      const sentText = data?.queued
        ? (t.announcementQueued ?? "Announcement queued for delivery.")
        : (t.announcementSentCount ?? "Announcement sent to {count} users").replace(
            "{count}",
            data.sentCount ?? 0,
          );

      toast.success(sentText);

      if (!data?.queued && (data.failureCount ?? 0) > 0) {
        const partialFailureText = (
          t.announcementPartialFailure ??
          "Some recipients did not receive the announcement. Failed: {count}"
        ).replace("{count}", data.failureCount);

        toast.error(partialFailureText);
      }

      setMessage("");
      operationIdRef.current = null;
      setIsOpen(false);
    } catch (err) {
      console.error("Failed to send announcement:", err.message);
      toast.error(err?.message || t.announcementError || "Failed to send announcement. Please try again.");
    } finally {
      setIsSending(false);
    }
  }

  return (
    <Sheet open={isOpen} onOpenChange={setIsOpen}>
      <SheetTrigger asChild>
        <Button type="button" variant="outline" className="rounded-xl">
          <Megaphone className="size-4" />
          <span>{t.newAnnouncement}</span>
        </Button>
      </SheetTrigger>

        <SheetContent
          side="right"
          className="sm:max-w-none"
          style={{ width: "100%", maxWidth: "36rem" }}
        >
          <form className="flex h-full flex-col" onSubmit={handleSend}>
            <div className="flex flex-1 flex-col gap-6 px-6 py-6">
              <SheetHeader className="gap-2 p-0 pr-10 text-left">
                <SheetTitle>{t.newAnnouncement}</SheetTitle>
                <SheetDescription>
                  {t.announcementDialogDescription}
                </SheetDescription>
              </SheetHeader>

              <div className="flex-1">
                <Label htmlFor="announcement-message" className="mb-2 block">
                  {t.announcementMessageLabel}
                </Label>
                <Textarea
                  id="announcement-message"
                  value={message}
                  onChange={(event) => {
                    const nextMessage = Array.from(event.target.value)
                      .slice(0, ANNOUNCEMENT_MESSAGE_MAX_LENGTH)
                      .join("");
                    operationIdRef.current = null;
                    setMessage(nextMessage);
                  }}
                  placeholder={t.newAnnouncementPlaceholder}
                  rows={6}
                  disabled={isSending}
                  className="h-40 min-h-32 max-h-[min(40svh,20rem)] rounded-xl"
                />
                <p className="mt-2 text-right text-xs text-muted-foreground">
                  {Array.from(message).length} / {ANNOUNCEMENT_MESSAGE_MAX_LENGTH}
                </p>
              </div>
            </div>

            <SheetFooter className="border-t px-6 py-4 sm:flex-row sm:justify-end">
              <SheetClose asChild>
                <Button
                  type="button"
                  variant="outline"
                  className="rounded-xl"
                  disabled={isSending}
                >
                  {t.cancel}
                </Button>
              </SheetClose>
              <Button
                type="submit"
                className="rounded-xl"
                disabled={isSending || !message.trim()}
              >
                <Megaphone className="size-4" />
                <span>{isSending ? t.announcementSending : t.sendAnnouncement}</span>
              </Button>
            </SheetFooter>
          </form>
        </SheetContent>
    </Sheet>
  );
}
