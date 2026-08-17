import { Skeleton } from "@/components/ui/skeleton";

export function ProfileSettingsSkeleton({ label = "Loading profile settings" }) {
  return (
    <div aria-busy="true" aria-label={label} className="flex flex-col gap-3 md:gap-8">
      <section className="rounded-2xl bg-card p-4 shadow-sm ring-1 ring-border md:rounded-3xl md:p-8">
        <Skeleton className="h-7 w-40 md:h-10 md:w-52" />
        <Skeleton className="mt-2 h-3 w-full max-w-3xl md:mt-3 md:h-4" />
      </section>

      <div className="grid gap-3 md:gap-8 xl:grid-cols-[320px_minmax(0,1fr)]">
        <section className="overflow-hidden rounded-2xl bg-card shadow-sm ring-1 ring-border md:rounded-3xl">
          <div className="border-b border-border px-4 py-3 md:px-6 md:py-6">
            <Skeleton className="h-5 w-32 md:h-7 md:w-40" />
            <Skeleton className="mt-2 h-3 w-4/5 md:mt-3 md:h-4 md:w-full" />
          </div>
          <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-3 px-4 py-3 md:flex md:flex-col md:gap-6 md:px-6 md:pb-8 md:pt-4">
            <div className="relative self-center">
              <Skeleton className="size-16 rounded-2xl md:size-20 md:rounded-[1.5rem] lg:size-[120px] lg:rounded-[2rem]" />
              <Skeleton className="absolute right-1 bottom-1 size-11 rounded-full" />
            </div>
            <div className="min-w-0 space-y-1 md:w-full md:space-y-2">
              <Skeleton className="h-4 w-36 max-w-full md:mx-auto md:w-44" />
              <Skeleton className="h-3 w-4/5 md:mx-auto" />
            </div>
            <div className="col-span-2 flex w-full justify-between gap-3 rounded-xl border border-border p-3 md:block md:space-y-2 md:rounded-2xl md:p-4">
              <Skeleton className="h-3 w-16 md:h-4" />
              <Skeleton className="h-3 w-32 md:w-3/4" />
            </div>
          </div>
        </section>

        <section className="overflow-hidden rounded-2xl bg-card shadow-sm ring-1 ring-border md:rounded-3xl">
          <div className="border-b border-border px-4 py-3 md:px-6 md:py-6">
            <Skeleton className="h-5 w-40 md:h-7 md:w-48" />
            <Skeleton className="mt-2 h-3 w-full max-w-xl md:mt-3 md:h-4" />
          </div>
          <div className="space-y-3 px-4 py-3 md:space-y-6 md:px-6 md:py-8">
            <Skeleton className="h-3 w-28" />
            <div className="grid grid-cols-1 gap-3 min-[360px]:grid-cols-2 md:max-w-[70%] md:gap-4">
              {Array.from({ length: 2 }, (_, index) => (
                <div key={index} className="space-y-2">
                  <Skeleton className="h-4 w-24" />
                  <Skeleton className="h-12 w-full rounded-xl" />
                </div>
              ))}
            </div>
            <div className="space-y-2">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-28 w-full rounded-xl md:h-36 md:rounded-2xl" />
            </div>
            <div className="sticky bottom-[calc(4rem+env(safe-area-inset-bottom))] z-30 -mx-4 flex justify-end border-t border-border bg-card/95 px-4 py-2 backdrop-blur md:static md:mx-0 md:border-0 md:bg-transparent md:p-0 md:backdrop-blur-none">
              <Skeleton className="h-9 w-32 rounded-xl" />
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
