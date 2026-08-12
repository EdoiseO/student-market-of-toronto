import { cn } from "@/lib/utils";

export function ListingDescriptionContent({ description, className }) {
  return (
    <div
      className={cn(
        "whitespace-pre-wrap break-words text-sm leading-6 text-zinc-600 dark:text-muted-foreground md:text-base md:leading-8",
        className,
      )}
    >
      {description}
    </div>
  );
}
