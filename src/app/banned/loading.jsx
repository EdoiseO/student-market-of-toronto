import { Skeleton } from "@/components/ui/skeleton";

export default function BannedStatusLoading() {
  return (
    <main aria-busy="true" aria-label="Loading account status" className="min-h-screen bg-zinc-100 px-5 py-8 dark:bg-background md:px-6 md:py-10">
      <div className="mx-auto flex min-h-[70vh] max-w-2xl items-center justify-center">
        <div className="flex w-full flex-col items-center gap-5 rounded-[2rem] bg-card p-6 shadow-sm ring-1 ring-border">
          <Skeleton className="size-14 rounded-2xl" />
          <Skeleton className="h-7 w-full max-w-56" />
          <div className="flex w-full max-w-md flex-wrap justify-center gap-2">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-3/4" />
          </div>
          <Skeleton className="h-20 w-full rounded-2xl" />
          <div className="flex w-full flex-wrap items-center justify-center gap-3">
            <Skeleton className="h-11 w-28 max-w-full" />
            <Skeleton className="h-11 w-64 max-w-full" />
          </div>
        </div>
      </div>
    </main>
  );
}
