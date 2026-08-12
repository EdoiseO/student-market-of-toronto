"use client";

import * as React from "react";
import { Megaphone } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useLanguage } from "@/context/LanguageContext";

export function AdminAnnouncementSheet() {
  const { t } = useLanguage();
  const [isOpen, setIsOpen] = React.useState(false);
  const [message, setMessage] = React.useState("");
  const [isSending, setIsSending] = React.useState(false);

  async function handleSend(event) {
    event.preventDefault();

    if (!message.trim() || isSending) {
      return;
    }

    setIsSending(true);

    try {
      const response = await fetch("/api/admin/announcements", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: message.trim() }),
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

      const sentText = (t.announcementSentCount ?? "Announcement sent to {count} users").replace(
        "{count}",
        data.sentCount ?? 0,
      );

      toast.success(sentText);

      if ((data.failureCount ?? 0) > 0) {
        const partialFailureText = (
          t.announcementPartialFailure ??
          "Some recipients did not receive the announcement. Failed: {count}"
        ).replace("{count}", data.failureCount);

        toast.error(partialFailureText);
      }

      setMessage("");
      setIsOpen(false);
    } catch (err) {
      console.error("Failed to send announcement:", err.message);
      toast.error(err?.message || t.announcementError || "Failed to send announcement. Please try again.");
    } finally {
      setIsSending(false);
    }
  }

  return (
    <>
      <Button
        type="button"
        variant="outline"
        className="rounded-xl"
        onClick={() => setIsOpen(true)}
      >
        <Megaphone className="size-4" />
        <span>{t.newAnnouncement}</span>
      </Button>

      <Sheet open={isOpen} onOpenChange={setIsOpen}>
        <SheetContent side="right" className="w-full sm:max-w-xl">
          <form className="flex h-full flex-col" onSubmit={handleSend}>
            <div className="flex flex-1 flex-col gap-6 px-6 py-6">
              <SheetHeader className="gap-2 p-0 text-left">
                <SheetTitle>{t.newAnnouncement}</SheetTitle>
                <SheetDescription>
                  {t.announcementDialogDescription}
                </SheetDescription>
              </SheetHeader>

              <div className="flex-1">
                <Textarea
                  value={message}
                  onChange={(event) => setMessage(event.target.value)}
                  placeholder={t.newAnnouncementPlaceholder}
                  rows={6}
                  maxLength={2000}
                  disabled={isSending}
                  className="h-40 min-h-32 max-h-[min(40svh,20rem)] rounded-xl"
                />
                <p className="mt-2 text-right text-xs text-muted-foreground">
                  {message.length} / 2000
                </p>
              </div>
            </div>

            <SheetFooter className="border-t px-6 py-4 sm:flex-row sm:justify-end">
              <Button
                type="button"
                variant="outline"
                className="rounded-xl"
                onClick={() => setIsOpen(false)}
                disabled={isSending}
              >
                {t.cancel}
              </Button>
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
    </>
  );
}
