import { Skeleton } from "@/components/ui/skeleton";

export function ProfileSettingsSkeleton() {
  return (
    <div aria-hidden="true" className="flex flex-col gap-8">
      <section className="rounded-3xl bg-card p-8 shadow-sm ring-1 ring-border">
        <Skeleton className="h-10 w-52" />
        <Skeleton className="mt-3 h-4 w-full max-w-3xl" />
        <Skeleton className="mt-2 h-4 w-4/5 max-w-2xl" />
      </section>

      <div className="grid gap-8 xl:grid-cols-[320px_minmax(0,1fr)]">
        <section className="overflow-hidden rounded-3xl bg-card shadow-sm ring-1 ring-border">
          <div className="border-b border-border px-6 py-6">
            <Skeleton className="h-7 w-40" />
            <Skeleton className="mt-3 h-4 w-full" />
            <Skeleton className="mt-2 h-4 w-4/5" />
          </div>
          <div className="flex flex-col items-center gap-6 px-6 pt-4 pb-8 text-center">
            <div className="relative">
              <Skeleton className="size-20 rounded-[1.5rem] lg:size-[120px] lg:rounded-[2rem]" />
              <Skeleton className="absolute right-1 bottom-1 size-11 rounded-full" />
            </div>
            <div className="w-full space-y-2">
              <Skeleton className="mx-auto h-4 w-44 max-w-full" />
              <Skeleton className="mx-auto h-3 w-4/5" />
            </div>
            <div className="w-full space-y-2 rounded-2xl border border-border p-4 text-left">
              <Skeleton className="h-4 w-16" />
              <Skeleton className="h-3 w-3/4" />
            </div>
          </div>
        </section>

        <section className="overflow-hidden rounded-3xl bg-card shadow-sm ring-1 ring-border">
          <div className="border-b border-border px-6 py-6">
            <Skeleton className="h-7 w-48" />
            <Skeleton className="mt-3 h-4 w-full max-w-xl" />
          </div>
          <div className="space-y-6 px-6 py-8">
            <div className="grid gap-4 md:max-w-[50%]">
              {Array.from({ length: 2 }, (_, index) => (
                <div key={index} className="space-y-2">
                  <Skeleton className="h-4 w-24" />
                  <Skeleton className="h-12 w-full rounded-xl" />
                </div>
              ))}
            </div>
            <div className="space-y-2">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-36 w-full rounded-2xl" />
            </div>
            <div className="flex justify-end">
              <Skeleton className="h-11 w-32 rounded-xl" />
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
