import { ListingCardSkeleton } from "./listing-card-skeleton";
import { Skeleton } from "@/components/ui/skeleton";

export function ProfileSkeleton() {
  return (
    <div aria-hidden="true" className="flex min-w-0 flex-col gap-3 md:gap-6">
      <section className="rounded-[1.5rem] bg-card p-3 shadow-sm ring-1 ring-border sm:p-6 lg:rounded-3xl lg:p-7">
        <div className="grid grid-cols-[auto_minmax(0,1fr)] items-start gap-x-3 gap-y-3 lg:grid-cols-[auto_minmax(0,1fr)_minmax(288px,304px)] lg:gap-x-6">
          <Skeleton className="size-16 rounded-2xl sm:size-28 sm:rounded-3xl" />
          <div className="flex min-w-0 self-center flex-col gap-2">
            <Skeleton className="h-4 w-14 rounded-full" />
            <Skeleton className="h-5 w-36 sm:h-8 sm:w-52" />
            <Skeleton className="h-3 w-28" />
          </div>

          <div className="col-span-2 flex min-w-0 items-center gap-2 lg:col-span-1 lg:col-start-3 lg:row-start-1 lg:gap-3">
            <div className="grid min-w-0 flex-1 grid-cols-2 gap-2 lg:gap-3">
              {Array.from({ length: 2 }, (_, index) => (
                <div key={index} className="flex min-w-0 items-center gap-2 rounded-xl border border-border p-2.5 sm:rounded-2xl sm:p-4">
                  <Skeleton className="size-4 shrink-0 rounded-full" />
                  <div className="min-w-0 flex-1 space-y-1.5">
                    <Skeleton className="h-2.5 w-16 max-w-full" />
                    <Skeleton className="h-3.5 w-12" />
                  </div>
                </div>
              ))}
            </div>
            <Skeleton className="size-11 shrink-0 rounded-xl" />
          </div>
        </div>

        <div className="mt-3 space-y-2 rounded-xl border border-border p-3 sm:mt-5 sm:rounded-2xl sm:p-5 lg:p-6">
          <Skeleton className="h-2.5 w-20" />
          <Skeleton className="h-3 w-full" />
          <Skeleton className="h-3 w-2/3" />
        </div>
      </section>

      <section className="rounded-[1.5rem] bg-card p-3 shadow-sm ring-1 ring-border sm:rounded-3xl sm:p-6 lg:p-7">
        <div className="mb-3 flex flex-col gap-2.5 sm:mb-4 sm:gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div className="flex items-center gap-2 sm:gap-3">
            <Skeleton className="size-4 shrink-0 rounded-full sm:size-5" />
            <div className="space-y-1.5">
              <Skeleton className="h-6 w-36 sm:h-7 sm:w-44" />
              <Skeleton className="h-3 w-52 max-w-[60vw]" />
            </div>
          </div>

          <div className="hidden items-end gap-2 md:flex lg:ml-auto">
            <Skeleton className="h-11 w-[152px] rounded-xl" />
            <Skeleton className="h-11 w-[168px] rounded-xl" />
            <Skeleton className="h-11 w-[240px] rounded-xl" />
            <Skeleton className="size-11 rounded-full" />
            <Skeleton className="size-11 rounded-full" />
          </div>
        </div>

        <div className="mb-3 flex items-center gap-2 md:hidden">
          <Skeleton className="h-11 min-w-0 flex-1 rounded-xl" />
          <Skeleton className="h-11 w-24 shrink-0 rounded-xl" />
        </div>

        <div className="-mx-1 flex items-start gap-3 overflow-hidden px-1 pb-3">
          {Array.from({ length: 4 }, (_, index) => (
            <div
              key={index}
              className="w-[calc((100%-0.75rem)/2)] min-w-0 flex-none sm:w-44 md:w-48 lg:w-52"
            >
              <ListingCardSkeleton compact />
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
