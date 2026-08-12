import { MessageThreadSkeleton } from "@/components/skeletons/message-thread-skeleton";
import { Skeleton } from "@/components/ui/skeleton";

export default function MessageThreadLoading() {
  return (
    <main aria-busy="true" aria-label="Loading conversation" className="h-full min-h-0 overflow-hidden bg-card md:bg-zinc-100 md:px-6 md:pt-3 md:pb-6 md:dark:bg-background lg:px-7">
      <div className="mx-auto flex h-full min-h-0 w-full max-w-[1040px] flex-col overflow-hidden rounded-xl bg-card md:border md:border-border">
        <div className="flex h-14 shrink-0 items-center gap-3 border-b border-border px-3">
          <Skeleton className="size-11 rounded-full" />
          <Skeleton className="h-5 w-40" />
        </div>
        <div className="min-h-0 flex-1 overflow-hidden">
          <MessageThreadSkeleton />
        </div>
        <div className="flex shrink-0 gap-2 border-t border-border p-3">
          <Skeleton className="h-11 flex-1 rounded-full" />
          <Skeleton className="size-11 rounded-full" />
        </div>
      </div>
    </main>
  );
}
