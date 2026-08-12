import { MessageThreadSkeleton } from "@/components/skeletons/message-thread-skeleton";
import { Skeleton } from "@/components/ui/skeleton";

export default function MessageThreadLoading() {
  return (
    <main aria-busy="true" aria-label="Loading conversation" className="h-full min-h-0 max-w-full touch-pan-y overflow-hidden overscroll-x-none bg-white dark:bg-card md:bg-zinc-100 md:px-4 md:pb-4 md:pt-2 md:dark:bg-background lg:px-5 lg:pb-5 lg:pt-3">
      <div className="mx-auto flex h-full min-h-0 w-full max-w-[1280px] flex-col overflow-hidden md:gap-0.5">
        <div className="shrink-0 px-2 py-0.5 md:px-0 md:py-0">
          <div className="flex min-h-11 items-center gap-2 px-3">
            <Skeleton className="size-4 rounded-full" />
            <Skeleton className="h-4 w-32" />
          </div>
        </div>
        <MessageThreadSkeleton />
      </div>
    </main>
  );
}
