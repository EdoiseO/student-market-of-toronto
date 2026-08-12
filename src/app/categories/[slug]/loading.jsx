import { ListingGridSkeleton } from "@/components/skeletons/listing-grid-skeleton";
import { Skeleton } from "@/components/ui/skeleton";

const CATEGORY_SECTION_COUNT = 4;

function CategoryResultsSectionSkeleton({ detailed = false }) {
  return (
    <section className="rounded-3xl bg-muted/40 p-4 shadow-sm ring-1 ring-border md:p-6">
      <div className="mb-5 space-y-2">
        <Skeleton className="h-7 w-44" />
        <Skeleton className="h-4 w-72 max-w-full" />
      </div>

      {detailed ? (
        <ListingGridSkeleton count={6} compact />
      ) : (
        <div className="grid min-w-0 grid-cols-2 gap-3 md:grid-cols-2 md:gap-4 lg:grid-cols-3 xl:grid-cols-6">
          {Array.from({ length: 6 }, (_, index) => (
            <Skeleton
              key={index}
              className="h-[200px] w-full rounded-xl md:h-[228px] lg:h-[240px]"
            />
          ))}
        </div>
      )}
    </section>
  );
}

export default function CategoryLoading() {
  return (
    <main aria-busy="true" aria-label="Loading category" className="min-h-screen min-w-0 overflow-x-clip bg-zinc-100 px-4 py-6 dark:bg-background md:p-8">
      <div className="mx-auto flex w-full max-w-[1440px] flex-col gap-8">
        <section className="rounded-3xl bg-card p-5 shadow-sm ring-1 ring-border md:p-8">
          <Skeleton className="h-9 w-56" />
          <Skeleton className="mt-3 h-4 w-full max-w-2xl" />
        </section>

        {Array.from({ length: CATEGORY_SECTION_COUNT }, (_, index) => (
          <CategoryResultsSectionSkeleton key={index} detailed={index === 0} />
        ))}
      </div>
    </main>
  );
}
