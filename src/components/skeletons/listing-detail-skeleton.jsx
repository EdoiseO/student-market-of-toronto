import { ListingCardSkeleton } from "@/components/skeletons/listing-card-skeleton";
import { Skeleton } from "@/components/ui/skeleton";

function ListingPhotoGallerySkeleton() {
  return (
    <div className="flex snap-x snap-mandatory gap-2 overflow-hidden pb-2 md:grid md:grid-cols-1 md:gap-4 md:pb-0 xl:grid-cols-2">
      {Array.from({ length: 2 }, (_, index) => (
        <Skeleton
          key={index}
          className="h-[216px] max-h-[240px] w-[85vw] shrink-0 rounded-2xl min-[430px]:h-[232px] md:h-[280px] md:w-full md:max-h-none"
        />
      ))}
    </div>
  );
}

function ListingDetailsSkeleton() {
  return (
    <div className="order-2 rounded-2xl bg-muted/40 p-4 ring-1 ring-border md:rounded-[2rem] md:p-7 xl:order-none">
      <div className="space-y-4 md:space-y-6">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 flex-1 space-y-2 md:space-y-3">
            <Skeleton className="h-5 w-20 rounded-full" />
            <div className="space-y-2">
              <Skeleton className="h-7 w-4/5 md:h-10" />
              <Skeleton className="h-7 w-28 md:h-9" />
            </div>
          </div>
          <Skeleton className="size-11 shrink-0 rounded-xl" />
        </div>

        <div className="grid grid-cols-2 gap-2 md:gap-3">
          {Array.from({ length: 2 }, (_, index) => (
            <div key={index} className="space-y-2 rounded-xl bg-card p-3 ring-1 ring-border md:rounded-2xl md:p-4">
              <Skeleton className="h-3 w-16" />
              <Skeleton className="h-4 w-4/5" />
            </div>
          ))}
        </div>

        <div className="fixed inset-x-0 bottom-[calc(4rem+env(safe-area-inset-bottom))] z-40 flex items-center gap-3 border-t border-border bg-background/95 px-4 py-3 shadow-[0_-8px_24px_rgba(0,0,0,0.06)] backdrop-blur md:static md:border-0 md:bg-transparent md:p-0 md:shadow-none">
          <Skeleton className="size-12 shrink-0 rounded-xl md:hidden" />
          <Skeleton className="h-12 min-w-0 flex-1 rounded-lg md:w-40 md:flex-none" />
        </div>
      </div>
    </div>
  );
}

function SellerSkeleton() {
  return (
    <div className="order-3 rounded-2xl bg-card p-4 ring-1 ring-border md:rounded-[2rem] md:p-7 xl:order-none">
      <div className="space-y-4 md:space-y-5">
        <div className="flex min-h-11 items-center gap-3 md:gap-4">
          <Skeleton className="size-12 shrink-0 rounded-xl md:size-14 md:rounded-2xl" />
          <div className="min-w-0 flex-1 space-y-2">
            <Skeleton className="h-5 w-40 max-w-full md:h-6" />
            <Skeleton className="h-3 w-32 max-w-full" />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2 md:gap-3">
          {Array.from({ length: 2 }, (_, index) => (
            <div key={index} className="flex items-center gap-2 rounded-xl bg-muted/40 p-3 ring-1 ring-border md:gap-3 md:rounded-2xl md:p-4">
              <Skeleton className="size-4 shrink-0 rounded-full" />
              <div className="min-w-0 flex-1 space-y-2">
                <Skeleton className="h-3 w-14" />
                <Skeleton className="h-3 w-20 max-w-full" />
              </div>
            </div>
          ))}
        </div>

        <Skeleton className="h-12 w-full rounded-lg" />
      </div>
    </div>
  );
}

function DescriptionSkeleton() {
  return (
    <div className="order-4 overflow-hidden rounded-2xl bg-card ring-1 ring-border md:rounded-[2rem] xl:order-none">
      <div className="border-b border-border px-4 py-3 md:px-7 md:py-5">
        <Skeleton className="h-6 w-32 md:h-7" />
      </div>
      <div className="space-y-2 px-4 py-4 md:px-7 md:py-6">
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-5/6" />
      </div>
    </div>
  );
}

function MeetupLocationSkeleton() {
  return (
    <section className="rounded-3xl bg-card p-4 shadow-sm ring-1 ring-border md:p-8">
      <div className="mb-3 flex items-center gap-2 md:mb-5 md:gap-3">
        <Skeleton className="size-4 shrink-0 rounded-full md:size-5" />
        <div className="min-w-0 flex-1 space-y-2">
          <Skeleton className="h-6 w-44 md:h-7" />
          <Skeleton className="h-3 w-64 max-w-full" />
        </div>
      </div>

      <div className="overflow-hidden rounded-2xl ring-1 ring-border md:rounded-[2rem]">
        <Skeleton className="h-[168px] w-full rounded-none min-[430px]:h-[184px] md:h-[288px]" />
        <div className="flex items-center gap-2.5 bg-card p-3 md:gap-3 md:p-4">
          <Skeleton className="hidden size-10 shrink-0 rounded-full min-[360px]:block" />
          <div className="min-w-0 flex-1 space-y-2">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-4 w-36 max-w-full" />
          </div>
          <Skeleton className="h-11 w-28 shrink-0 rounded-xl" />
        </div>
      </div>
    </section>
  );
}

function SimilarListingsSkeleton() {
  return (
    <section className="rounded-3xl bg-muted/40 p-4 shadow-sm ring-1 ring-border md:p-8">
      <div className="mb-5 flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1 space-y-2">
          <Skeleton className="h-7 w-44" />
          <Skeleton className="h-4 w-64 max-w-full" />
        </div>
        <div className="hidden gap-2 md:flex">
          <Skeleton className="size-11 rounded-full" />
          <Skeleton className="size-11 rounded-full" />
        </div>
      </div>

      <div className="-mx-1 flex items-start gap-3 overflow-hidden px-1 pb-3">
        {Array.from({ length: 4 }, (_, index) => (
          <div
            key={index}
            className="w-[calc((100%_-_0.75rem)/2)] max-w-48 min-w-0 flex-none sm:w-44 md:w-48 lg:w-52 lg:max-w-52"
          >
            <ListingCardSkeleton compact />
          </div>
        ))}
      </div>
    </section>
  );
}

export function ListingDetailSkeleton() {
  return (
    <div aria-hidden="true" className="flex min-w-0 flex-col gap-4 md:gap-8">
      <section className="rounded-3xl bg-card p-3 shadow-sm ring-1 ring-border md:p-8">
        <div className="grid gap-5 md:gap-8 xl:grid-cols-[minmax(0,1.45fr)_minmax(256px,0.95fr)]">
          <div className="contents xl:flex xl:flex-col xl:gap-5">
            <div className="order-1 min-w-0 xl:order-none">
              <ListingPhotoGallerySkeleton />
            </div>
            <DescriptionSkeleton />
          </div>

          <div className="contents xl:flex xl:flex-col xl:gap-5">
            <ListingDetailsSkeleton />
            <SellerSkeleton />
          </div>
        </div>
      </section>

      <MeetupLocationSkeleton />
      <SimilarListingsSkeleton />
    </div>
  );
}
