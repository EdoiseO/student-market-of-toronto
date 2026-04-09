import { cn } from "@/lib/utils";

export function ListingDescriptionContent({ description, className }) {
  return (
    <div
      className={cn(
        "whitespace-pre-wrap break-words text-base leading-8 text-zinc-600 dark:text-muted-foreground",
        className,
      )}
    >
      {description}
    </div>
  );
}
