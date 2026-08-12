import { Skeleton } from "@/components/ui/skeleton";

function MessageRowSkeleton() {
  return (
    <div className="flex min-w-0 items-center gap-3 border-b border-border p-4 last:border-b-0">
      <Skeleton className="size-11 shrink-0 rounded-full" />
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="flex justify-between gap-3">
          <Skeleton className="h-4 w-1/3" />
          <Skeleton className="h-3 w-12 shrink-0" />
        </div>
        <Skeleton className="h-3 w-2/3" />
      </div>
    </div>
  );
}

export function MessageListSkeleton({ count = 6 }) {
  return (
    <div aria-hidden="true" className="flex flex-col">
      {Array.from({ length: count }, (_, index) => (
        <MessageRowSkeleton key={index} />
      ))}
    </div>
  );
}
