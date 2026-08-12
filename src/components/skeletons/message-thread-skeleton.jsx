import { Skeleton } from "@/components/ui/skeleton";

function BubbleSkeleton({ side = "left" }) {
  const isRight = side === "right";

  return (
    <div className={`flex items-end gap-2 ${isRight ? "flex-row-reverse" : ""}`}>
      <Skeleton className="size-8 shrink-0 rounded-full md:size-9" />
      <Skeleton
        className={`h-12 max-w-[68%] rounded-[1.25rem] ${
          isRight ? "w-36 rounded-tr-sm" : "w-48 rounded-tl-sm"
        }`}
      />
    </div>
  );
}

export function MessageThreadSkeleton() {
  return (
    <section
      aria-hidden="true"
      className="flex min-h-0 flex-1 flex-col overflow-hidden border-y border-zinc-200 bg-white/95 dark:border-border dark:bg-card md:rounded-[2rem] md:border md:shadow-sm"
    >
      <div className="shrink-0 border-b border-zinc-200 p-3 dark:border-border md:p-5">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="rounded-2xl border border-zinc-200/80 bg-zinc-50/80 p-2.5 dark:border-border dark:bg-muted/30 lg:w-full lg:max-w-md">
            <div className="flex items-center gap-3">
              <Skeleton className="size-12 shrink-0 rounded-xl md:size-14" />
              <div className="min-w-0 flex-1 space-y-1.5">
                <Skeleton className="h-3.5 w-4/5" />
                <Skeleton className="h-3 w-20" />
                <Skeleton className="h-2.5 w-2/3" />
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 lg:self-center">
            <Skeleton className="size-9 shrink-0 rounded-full" />
            <div className="min-w-0 space-y-1.5">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-2.5 w-24" />
            </div>
            <Skeleton className="size-11 shrink-0 rounded-full" />
          </div>
        </div>
      </div>

      <div className="min-h-0 flex-1 space-y-3.5 overflow-hidden bg-zinc-50/60 px-3.5 py-4 dark:bg-muted/15 md:space-y-4 md:px-6 md:py-5">
        <BubbleSkeleton />
        <BubbleSkeleton side="right" />
        <BubbleSkeleton />
        <BubbleSkeleton side="right" />
        <BubbleSkeleton />
      </div>

      <div className="shrink-0 border-t border-zinc-200 bg-white/95 px-3 py-2.5 pb-[max(0.625rem,env(safe-area-inset-bottom))] dark:border-border dark:bg-card/95 md:p-5">
        <div className="rounded-[1.35rem] border border-zinc-200 bg-zinc-50/70 p-2.5 dark:border-border dark:bg-muted/20">
          <Skeleton className="h-12 w-full rounded-xl md:h-14" />
          <div className="mt-1.5 flex items-center justify-between gap-3 border-t border-zinc-200 px-1.5 pt-2 dark:border-border">
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
