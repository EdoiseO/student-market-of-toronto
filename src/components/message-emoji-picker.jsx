"use client";

import * as React from "react";
import { SmilePlus } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  MESSAGE_COMPOSER_EMOJIS,
  NATIVE_EMOJI_FONT_FAMILY,
} from "@/lib/message-emojis.mjs";

export function MessageEmojiPicker({ disabled, labels, onSelect }) {
  const [isOpen, setIsOpen] = React.useState(false);

  function handleSelect(emoji) {
    setIsOpen(false);
    onSelect(emoji);
  }

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="size-11 rounded-full text-zinc-500 hover:bg-zinc-200/70 hover:text-zinc-950 dark:text-muted-foreground dark:hover:bg-zinc-800 dark:hover:text-foreground"
          disabled={disabled}
          aria-label={labels.addEmoji}
        >
          <SmilePlus className="size-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        side="top"
        sideOffset={8}
        aria-label={labels.pickerLabel}
        className="w-[min(19rem,calc(100vw-1rem))] gap-2 rounded-2xl border border-zinc-200 bg-white/98 p-2.5 shadow-xl dark:border-zinc-700 dark:bg-zinc-900/98"
      >
        <div className="px-1">
          <p className="text-sm font-semibold text-zinc-950 dark:text-zinc-50">
            {labels.pickerLabel}
          </p>
          <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
            {labels.pickerHint}
          </p>
        </div>
        <div className="grid grid-cols-6 gap-0.5" role="group" aria-label={labels.pickerLabel}>
          {MESSAGE_COMPOSER_EMOJIS.map((emoji) => (
            <button
              key={emoji}
              type="button"
              onClick={() => handleSelect(emoji)}
              aria-label={`${labels.insertEmoji} ${emoji}`}
              className="flex size-11 min-h-11 min-w-11 items-center justify-center rounded-xl text-[1.35rem] leading-none transition hover:-translate-y-0.5 hover:bg-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 active:translate-y-0 dark:hover:bg-zinc-800"
              style={{ fontFamily: NATIVE_EMOJI_FONT_FAMILY }}
            >
              <span aria-hidden="true">{emoji}</span>
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
