import { Skeleton } from "@/components/ui/skeleton";

function BubbleSkeleton({ side = "left" }) {
  const isRight = side === "right";

  return (
    <div className={`flex items-end gap-3 ${isRight ? "flex-row-reverse" : ""}`}>
      <Skeleton className="size-10 shrink-0 rounded-full" />
      <Skeleton
        className={`h-14 max-w-[70%] rounded-[1.5rem] ${
          isRight ? "w-36 rounded-tr-md" : "w-48 rounded-tl-md"
        }`}
      />
    </div>
  );
}

export function MessageThreadSkeleton() {
  return (
    <section
      aria-hidden="true"
      className="flex min-h-0 flex-1 flex-col overflow-hidden border-y border-zinc-200 bg-white shadow-sm dark:border-border dark:bg-card md:rounded-[2rem] md:border"
    >
      <div className="shrink-0 border-b border-zinc-200 p-4 dark:border-border md:p-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="rounded-2xl bg-zinc-50 p-4 dark:bg-muted/40 lg:w-full lg:max-w-md">
            <div className="flex items-center gap-4">
              <Skeleton className="size-14 shrink-0 rounded-2xl md:size-18" />
              <div className="min-w-0 flex-1 space-y-2">
                <Skeleton className="h-4 w-4/5" />
                <Skeleton className="h-3 w-24" />
                <Skeleton className="h-3 w-2/3" />
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 lg:self-center">
            <Skeleton className="size-10 shrink-0 rounded-full" />
            <div className="min-w-0 space-y-2">
              <Skeleton className="h-5 w-32" />
              <Skeleton className="h-3 w-24" />
            </div>
            <Skeleton className="size-11 shrink-0 rounded-full" />
          </div>
        </div>
      </div>

      <div className="min-h-0 flex-1 space-y-5 overflow-hidden bg-zinc-50/70 px-4 pt-3 pb-5 dark:bg-muted/20 md:px-6 md:pb-6">
        <BubbleSkeleton />
        <BubbleSkeleton side="right" />
        <BubbleSkeleton />
        <BubbleSkeleton side="right" />
        <BubbleSkeleton />
      </div>

      <div className="shrink-0 border-t border-zinc-200 bg-background px-3 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] dark:border-border md:p-6">
        <div className="rounded-[1.75rem] border border-zinc-200 bg-background p-3 shadow-sm dark:border-border">
          <Skeleton className="h-16 w-full rounded-2xl" />
          <div className="mt-2 flex items-center justify-between gap-3 border-t border-zinc-200 px-2 pt-3 dark:border-border">
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
