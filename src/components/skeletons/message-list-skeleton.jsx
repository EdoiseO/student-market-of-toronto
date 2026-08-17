import { Skeleton } from "@/components/ui/skeleton";

function MessageRowSkeleton({ showStatus = false }) {
  return (
    <div className="flex min-w-0 items-center border-b border-border px-4 py-3 last:border-b-0 md:px-6">
      <Skeleton className="size-11 shrink-0 rounded-full" />
      <div className="ml-3 min-w-0 flex-1 py-0.5">
        <div className="flex min-w-0 items-center justify-between gap-3">
          <Skeleton className="h-4 w-1/3" />
          <Skeleton className="h-3 w-12 shrink-0" />
        </div>
        <div className="mt-2 flex items-center gap-1.5">
          {showStatus ? <Skeleton className="h-5 w-14 shrink-0 rounded-full" /> : null}
          <Skeleton className="h-3 w-2/3" />
        </div>
      </div>
      <Skeleton className="ml-1 size-11 shrink-0 rounded-full" />
    </div>
  );
}

export function MessageListSkeleton({ count = 6 }) {
  return (
    <div aria-hidden="true" className="flex flex-col">
      {Array.from({ length: count }, (_, index) => (
        <MessageRowSkeleton key={index} showStatus={index === 1 || index === 4} />
      ))}
    </div>
  );
}
