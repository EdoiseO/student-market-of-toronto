import { Skeleton } from "@/components/ui/skeleton";

export default function EditListingLoading() {
  return (
    <main aria-busy="true" aria-label="Loading listing editor" className="min-h-screen bg-zinc-100 p-3 dark:bg-background md:p-8">
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-4 rounded-3xl bg-card p-4 shadow-sm ring-1 ring-border md:gap-6 md:p-8">
        <Skeleton className="h-8 w-56" />
        <Skeleton className="h-4 w-3/4" />
        <div className="grid gap-4 md:grid-cols-2">
          {Array.from({ length: 4 }, (_, index) => (
            <div key={index} className="space-y-2">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-11 w-full" />
            </div>
          ))}
        </div>
        <Skeleton className="h-28 w-full" />
        <div className="flex justify-end gap-3">
          <Skeleton className="h-11 w-24" />
          <Skeleton className="h-11 w-32" />
        </div>
      </div>
    </main>
  );
}
