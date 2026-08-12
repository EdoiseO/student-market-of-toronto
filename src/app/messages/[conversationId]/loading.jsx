import { MessageThreadSkeleton } from "@/components/skeletons/message-thread-skeleton";
import { Skeleton } from "@/components/ui/skeleton";

export default function MessageThreadLoading() {
  return (
    <main aria-busy="true" aria-label="Loading conversation" className="h-full min-h-0 overflow-hidden bg-white dark:bg-card md:bg-zinc-100 md:px-6 md:pt-3 md:pb-6 md:dark:bg-background lg:px-7 lg:pt-4 lg:pb-7">
      <div className="mx-auto flex h-full min-h-0 w-full max-w-[1040px] flex-col overflow-hidden md:gap-1">
        <div className="shrink-0 px-2 py-1 md:px-0 md:py-0">
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
