import { MessageListSkeleton } from "@/components/skeletons/message-list-skeleton";
import { Skeleton } from "@/components/ui/skeleton";

export default function MessagesLoading() {
  return (
    <main aria-busy="true" aria-label="Loading conversations" className="min-h-screen min-w-0 overflow-x-clip bg-card md:bg-zinc-100 md:p-6 md:dark:bg-background lg:p-7">
      <div className="mx-auto w-full max-w-[1360px] overflow-hidden bg-card md:rounded-[2rem] md:border md:border-border md:shadow-sm">
        <div className="border-b border-border px-4 py-5 md:px-6">
          <Skeleton className="h-8 w-48" />
        </div>
        <MessageListSkeleton />
      </div>
    </main>
  );
}
