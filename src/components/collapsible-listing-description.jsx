"use client";

import * as React from "react";

import { ListingDescriptionContent } from "@/components/listing-description-content";
import { useLanguage } from "@/context/LanguageContext";
import { cn } from "@/lib/utils";

export function CollapsibleListingDescription({ description, className }) {
  const [isExpanded, setIsExpanded] = React.useState(false);
  const { language } = useLanguage();

  return (
    <div>
      <ListingDescriptionContent
        description={description}
        className={cn("max-w-prose", !isExpanded && "line-clamp-3 md:line-clamp-none", className)}
      />
      <button
        type="button"
        aria-expanded={isExpanded}
        onClick={() => setIsExpanded((currentValue) => !currentValue)}
        className="mt-1 inline-flex min-h-11 items-center rounded-lg px-1 text-xs font-semibold text-foreground underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:hidden"
      >
        {isExpanded
          ? language === "fr"
            ? "Afficher moins"
            : "Show less"
          : language === "fr"
            ? "Lire la suite"
            : "Read more"}
      </button>
    </div>
  );
}
