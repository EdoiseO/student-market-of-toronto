"use client";

import * as React from "react";
import { Megaphone } from "lucide-react";
import { toast } from "sonner";

import { useLanguage } from "@/context/LanguageContext";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";

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
                <textarea
                  data-slot="textarea"
                  value={message}
                  onChange={(event) => setMessage(event.target.value)}
                  placeholder={t.newAnnouncementPlaceholder}
                  rows={10}
                  maxLength={2000}
                  disabled={isSending}
                  className="min-h-16 w-full resize-none rounded-xl border border-input bg-transparent px-2.5 py-2 text-base transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:bg-input/50 disabled:opacity-50 md:text-sm dark:bg-input/30"
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
