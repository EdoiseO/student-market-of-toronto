import { Skeleton } from "@/components/ui/skeleton";

export default function CreateListingLoading() {
  return (
    <main aria-busy="true" aria-label="Loading listing form" className="min-h-screen bg-zinc-100 p-4 dark:bg-background md:p-8">
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 rounded-3xl bg-card p-5 shadow-sm ring-1 ring-border md:p-8">
        <Skeleton className="h-8 w-52" />
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
        <Skeleton className="h-11 w-full md:ml-auto md:w-36" />
      </div>
    </main>
  );
}
