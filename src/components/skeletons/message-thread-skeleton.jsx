import { Skeleton } from "@/components/ui/skeleton";

function BubbleSkeleton({ side = "left" }) {
  const isRight = side === "right";

  return (
    <div className={`mx-auto flex w-full max-w-4xl items-end gap-1.5 ${isRight ? "flex-row-reverse" : ""}`}>
      <Skeleton className="size-7 shrink-0 rounded-full md:size-8" />
      <div className={`space-y-1 ${isRight ? "flex flex-col items-end" : ""}`}>
        <Skeleton className="h-2.5 w-24" />
        <Skeleton
          className={`h-10 rounded-[1.1rem] ${
            isRight ? "w-36 rounded-tr-sm" : "w-48 rounded-tl-sm"
          }`}
        />
      </div>
    </div>
  );
}

function MediaBubbleSkeleton() {
  return (
    <div className="mx-auto flex w-full max-w-4xl items-end gap-1.5">
      <Skeleton className="size-7 shrink-0 rounded-full md:size-8" />
      <div className="space-y-1">
        <Skeleton className="h-2.5 w-28" />
        <div className="grid w-56 grid-cols-2 gap-px overflow-hidden rounded-[1.1rem] border border-zinc-200 p-1 dark:border-border sm:w-64">
          <Skeleton className="aspect-square rounded-l-xl" />
          <Skeleton className="aspect-square rounded-r-xl" />
          <Skeleton className="col-span-2 h-4 w-3/4 rounded-md" />
        </div>
      </div>
    </div>
  );
}

export function MessageThreadSkeleton() {
  return (
    <section
      aria-hidden="true"
      className="flex min-h-0 max-w-full flex-1 touch-pan-y flex-col overflow-hidden overscroll-x-none border-y border-zinc-200 bg-white/95 dark:border-border dark:bg-card md:rounded-[1.5rem] md:border md:shadow-sm"
    >
      <div className="shrink-0 border-b border-zinc-200 px-3 py-2.5 dark:border-border md:px-4 md:py-3">
        <div className="flex flex-col gap-2.5 md:flex-row md:items-center md:justify-between">
          <div className="rounded-xl border border-zinc-200/80 bg-zinc-50/80 p-2 dark:border-border dark:bg-muted/30 md:w-full md:max-w-sm">
            <div className="flex items-center gap-3">
              <Skeleton className="size-11 shrink-0 rounded-lg md:size-12" />
              <div className="min-w-0 flex-1 space-y-1.5">
                <Skeleton className="h-3.5 w-4/5" />
                <Skeleton className="h-3 w-20" />
                <Skeleton className="h-2.5 w-2/3" />
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 md:self-center">
            <Skeleton className="size-8 shrink-0 rounded-full md:size-9" />
            <div className="min-w-0 space-y-1.5">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-2.5 w-24" />
            </div>
            <Skeleton className="size-11 shrink-0 rounded-full" />
          </div>
        </div>
      </div>

      <div className="min-h-0 flex-1 space-y-2.5 overflow-hidden bg-zinc-50/60 px-3 py-3 dark:bg-muted/15 md:space-y-3 md:px-5 md:py-4">
        <BubbleSkeleton />
        <BubbleSkeleton side="right" />
        <MediaBubbleSkeleton />
        <BubbleSkeleton side="right" />
        <BubbleSkeleton />
      </div>

      <div className="shrink-0 border-t border-zinc-200 bg-white/95 px-2.5 py-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] dark:border-border dark:bg-card/95 md:px-4 md:py-3">
        <div className="mx-auto max-w-4xl rounded-[1.1rem] border border-zinc-200 bg-zinc-50/70 p-1.5 dark:border-border dark:bg-muted/20">
          <Skeleton className="h-11 w-full rounded-xl" />
          <div className="mt-0.5 flex items-center justify-between gap-3 border-t border-zinc-200 px-1 pt-1.5 dark:border-border">
            <div className="flex gap-2">
              <Skeleton className="size-11 rounded-full" />
              <Skeleton className="size-11 rounded-full" />
            </div>
            <Skeleton className="h-11 w-28 rounded-full" />
          </div>
        </div>
      </div>
    </section>
  );
}
