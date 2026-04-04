"use client";

import * as React from "react";
import { Ellipsis, Flag, Share2 } from "lucide-react";
import { toast } from "sonner";

import { useLanguage } from "@/context/LanguageContext";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

async function copyText(value) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "absolute";
  textarea.style.left = "-9999px";
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand("copy");
  document.body.removeChild(textarea);
}

export function ListingMoreButton({ slug }) {
  const { t } = useLanguage();

  async function handleShare() {
    try {
      const listingUrl = typeof window !== "undefined"
        ? window.location.href
        : `/listings/${slug}`;

      await copyText(listingUrl);
      toast.success(t.listingLinkCopied);
    } catch {
      toast.error(t.listingLinkCopyError);
    }
  }

  function handleReport() {
    toast.error(t.reportListingUnavailable);
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="icon"
          aria-label={t.moreActions}
          className="size-11 rounded-full border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-100 dark:border-border dark:bg-background dark:text-foreground dark:hover:bg-muted"
        >
          <Ellipsis className="size-5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48 rounded-2xl">
        <DropdownMenuItem onClick={handleShare}>
          <Share2 className="size-4" />
          <span>{t.shareListing}</span>
        </DropdownMenuItem>
        <DropdownMenuItem onClick={handleReport}>
          <Flag className="size-4" />
          <span>{t.reportListing}</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
