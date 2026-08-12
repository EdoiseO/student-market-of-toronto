import { ListingGridSkeleton } from "@/components/skeletons/listing-grid-skeleton";
import { Skeleton } from "@/components/ui/skeleton";

export default function CategoryLoading() {
  return (
    <main aria-busy="true" aria-label="Loading category" className="min-h-screen min-w-0 overflow-x-clip bg-zinc-100 px-4 py-6 dark:bg-background md:p-8">
      <div className="mx-auto flex w-full max-w-[1440px] flex-col gap-8">
        <section className="rounded-3xl bg-card p-6 shadow-sm ring-1 ring-border md:p-8">
          <Skeleton className="h-9 w-56" />
          <Skeleton className="mt-3 h-4 w-full max-w-2xl" />
        </section>
        <section className="rounded-3xl bg-muted/40 p-4 shadow-sm ring-1 ring-border md:p-8">
          <Skeleton className="mb-5 h-7 w-44" />
          <ListingGridSkeleton count={6} compact />
        </section>
      </div>
    </main>
  );
}
