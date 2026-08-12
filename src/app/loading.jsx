import { ListingCardSkeleton } from "@/components/skeletons/listing-card-skeleton";
import { Skeleton } from "@/components/ui/skeleton";

const HOME_CATEGORY_COUNT = 10;

function CategorySectionSkeleton({ detailed = false }) {
  return (
    <section className="min-w-0 rounded-3xl bg-muted/40 p-4 shadow-sm ring-1 ring-border md:p-6">
      <div className="mb-5 space-y-2">
        <Skeleton className="h-7 w-48" />
        <Skeleton className="h-4 w-64 max-w-full" />
      </div>

      {detailed ? (
        <div className="grid min-w-0 grid-cols-2 gap-3 md:grid-cols-2 md:gap-4 lg:grid-cols-3 xl:grid-cols-6">
          {Array.from({ length: 6 }, (_, index) => (
            <div key={index} className={index >= 4 ? "hidden xl:block" : undefined}>
              <ListingCardSkeleton compact />
            </div>
          ))}
        </div>
      ) : (
        <div className="grid min-w-0 grid-cols-2 gap-3 md:grid-cols-2 md:gap-4 lg:grid-cols-3 xl:grid-cols-6">
          {Array.from({ length: 6 }, (_, index) => (
            <div key={index} className={index >= 4 ? "hidden xl:block" : undefined}>
              <Skeleton className="h-[200px] w-full rounded-xl md:h-[228px] lg:h-[240px]" />
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

export default function HomeLoading() {
  return (
    <main aria-busy="true" aria-label="Loading marketplace" className="min-h-screen min-w-0 overflow-x-clip bg-zinc-100 px-4 py-6 dark:bg-background md:p-8">
      <div className="mx-auto flex min-w-0 w-full max-w-[1440px] flex-col gap-6 md:gap-8">
        <section className="rounded-2xl bg-card px-4 py-4 shadow-sm ring-1 ring-border md:rounded-3xl md:p-8">
          <Skeleton className="h-6 w-4/5 max-w-xl sm:h-7 md:h-9 md:w-2/3" />
          <Skeleton className="mt-2 h-3.5 w-full max-w-2xl md:mt-4 md:h-4" />
          <Skeleton className="mt-1.5 h-3.5 w-3/4 max-w-xl md:mt-2 md:h-4 md:w-4/5" />
        </section>

        {Array.from({ length: HOME_CATEGORY_COUNT }, (_, index) => (
          <CategorySectionSkeleton key={index} detailed={index === 0} />
        ))}
      </div>
    </main>
  );
}
