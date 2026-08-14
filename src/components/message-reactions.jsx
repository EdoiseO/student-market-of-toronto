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
  countAdditionalMessageReactions,
  groupMessageReactions,
  MESSAGE_REACTION_OPTIONS,
} from "@/lib/message-reactions.mjs";

export function MessageReactions({
  reactions,
  currentUserId,
  isCurrentUser,
  isPending,
  isAddingDisabled,
  onToggle,
  labels,
}) {
  const groups = groupMessageReactions(reactions, currentUserId);
  const additionalReactionCount = countAdditionalMessageReactions(groups);
  const [isPickerOpen, setIsPickerOpen] = React.useState(false);

  function handlePickerReaction(emoji, reactedByCurrentUser) {
    setIsPickerOpen(false);
    onToggle(emoji, reactedByCurrentUser);
  }

  return (
    <div
      className={`relative z-10 -mt-1.5 flex min-h-7 w-max max-w-[calc(100vw-6rem)] flex-nowrap items-center gap-0.5 ${
        isCurrentUser ? "self-end justify-end" : "self-start justify-start"
      }`}
      role="group"
      aria-label={labels.reactions}
    >
      {groups.length > 0 ? (
        <div className="inline-flex min-h-6 shrink-0 items-center gap-px rounded-full border border-zinc-200 bg-white/95 px-1 py-0 shadow-[0_1px_2px_rgba(0,0,0,0.06)] dark:border-zinc-700 dark:bg-zinc-900/95">
          {groups.map((group) => {
            const canToggle = group.reactedByCurrentUser || !isAddingDisabled;
            const actionLabel = group.reactedByCurrentUser
              ? labels.removeReaction
              : labels.addReaction;

            return (
              <button
                key={group.emoji}
                type="button"
                onClick={() => onToggle(group.emoji, group.reactedByCurrentUser)}
                disabled={isPending || !canToggle}
                aria-pressed={group.reactedByCurrentUser}
                aria-label={`${actionLabel} ${group.emoji}. ${labels.reactionCount(group.count)}`}
                className="relative inline-flex !size-6 !min-h-6 !min-w-6 items-center justify-center rounded-full text-[0.8125rem] leading-none transition hover:bg-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-60 dark:hover:bg-zinc-800"
              >
                <span aria-hidden="true">{group.emoji}</span>
              </button>
            );
          })}

          {additionalReactionCount > 0 ? (
            <span
              className="pl-0.5 pr-0.5 text-[0.6875rem] font-semibold leading-none text-zinc-700 dark:text-zinc-200"
              aria-hidden="true"
            >
              +{additionalReactionCount}
            </span>
          ) : null}
        </div>
      ) : null}

      {!isAddingDisabled ? (
        <Popover open={isPickerOpen} onOpenChange={setIsPickerOpen}>
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="outline"
              size="icon-sm"
              disabled={isPending}
              aria-label={labels.addReaction}
              className={`relative !size-7 !min-h-7 !min-w-7 rounded-full border-zinc-200 bg-white/95 text-zinc-500 shadow-sm hover:bg-zinc-50 hover:text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900/95 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100 ${
                groups.length === 0
                  ? "md:opacity-0 md:transition-opacity md:group-hover/message:opacity-100 md:group-focus-within/message:opacity-100"
                  : ""
              }`}
            >
              <SmilePlus className="size-3" />
            </Button>
          </PopoverTrigger>
          <PopoverContent
            align={isCurrentUser ? "end" : "start"}
            side="top"
            sideOffset={8}
            className="w-auto rounded-full border border-zinc-200 bg-white/98 p-1.5 shadow-lg dark:border-zinc-700 dark:bg-zinc-900/98"
          >
            <div className="flex items-center gap-0.5" role="group" aria-label={labels.pickerLabel}>
              {MESSAGE_REACTION_OPTIONS.map((emoji) => {
                const reactedByCurrentUser = reactions?.some(
                  (reaction) =>
                    reaction.emoji === emoji && reaction.user_id === currentUserId,
                );

                return (
                  <button
                    key={emoji}
                    type="button"
                    onClick={() => handlePickerReaction(emoji, reactedByCurrentUser)}
                    aria-pressed={reactedByCurrentUser}
                    aria-label={`${
                      reactedByCurrentUser ? labels.removeReaction : labels.addReaction
                    } ${emoji}`}
                    className={`relative flex !size-10 !min-h-10 !min-w-10 items-center justify-center rounded-full text-xl transition after:absolute after:-inset-1 after:content-[''] hover:-translate-y-0.5 hover:bg-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 dark:hover:bg-zinc-800 ${
                      reactedByCurrentUser
                        ? "bg-zinc-100 ring-1 ring-zinc-300 dark:bg-zinc-800 dark:ring-zinc-600"
                        : ""
                    }`}
                  >
                    <span aria-hidden="true">{emoji}</span>
                  </button>
                );
              })}
            </div>
          </PopoverContent>
        </Popover>
      ) : null}
    </div>
  );
}
