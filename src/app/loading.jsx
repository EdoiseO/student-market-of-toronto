import { ListingGridSkeleton } from "@/components/skeletons/listing-grid-skeleton";
import { Skeleton } from "@/components/ui/skeleton";

export default function HomeLoading() {
  return (
    <main aria-busy="true" aria-label="Loading marketplace" className="min-h-screen min-w-0 overflow-x-clip bg-zinc-100 px-4 py-6 dark:bg-background md:p-8">
      <div className="mx-auto flex min-w-0 w-full max-w-[1440px] flex-col gap-6 md:gap-8">
        <section className="rounded-3xl bg-card p-6 shadow-sm ring-1 ring-border md:p-8">
          <Skeleton className="h-9 w-2/3 max-w-xl" />
          <Skeleton className="mt-4 h-4 w-full max-w-2xl" />
          <Skeleton className="mt-2 h-4 w-4/5 max-w-xl" />
        </section>
        <section className="rounded-3xl bg-muted/40 p-4 shadow-sm ring-1 ring-border md:p-8">
          <Skeleton className="mb-5 h-7 w-48" />
          <ListingGridSkeleton count={4} compact />
        </section>
      </div>
    </main>
  );
}
