"use client";

import * as React from "react";

import { useLanguage } from "@/context/LanguageContext";
import { cn } from "@/lib/utils";

export function CollapsibleProfileBio({ bio, className }) {
  const [isExpanded, setIsExpanded] = React.useState(false);
  const [canExpand, setCanExpand] = React.useState(false);
  const textRef = React.useRef(null);
  const { language } = useLanguage();

  React.useEffect(() => {
    const textElement = textRef.current;

    if (!textElement || isExpanded) {
      return undefined;
    }

    const updateOverflowState = () => {
      setCanExpand(textElement.scrollHeight > textElement.clientHeight + 1);
    };

    updateOverflowState();

    const resizeObserver = new ResizeObserver(updateOverflowState);
    resizeObserver.observe(textElement);

    return () => resizeObserver.disconnect();
  }, [bio, isExpanded]);

  return (
    <div>
      <p
        ref={textRef}
        className={cn(
          "whitespace-pre-line text-xs leading-5 text-zinc-600 dark:text-muted-foreground sm:text-base sm:leading-7",
          !isExpanded && "line-clamp-2 sm:line-clamp-none",
          className,
        )}
      >
        {bio}
      </p>
      {canExpand ? (
        <button
          type="button"
          aria-expanded={isExpanded}
          onClick={() => setIsExpanded((currentValue) => !currentValue)}
          className="mt-0.5 inline-flex min-h-11 items-center rounded-lg pr-2 text-xs font-semibold text-foreground underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:hidden"
        >
          {isExpanded
            ? language === "fr"
              ? "Afficher moins"
              : "Show less"
            : language === "fr"
              ? "Lire la suite"
              : "Read more"}
        </button>
      ) : null}
    </div>
  );
}
