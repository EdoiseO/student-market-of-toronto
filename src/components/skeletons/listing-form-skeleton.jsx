import { Skeleton } from "@/components/ui/skeleton";

function FieldSkeleton({ multiline = false }) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-3 w-14" />
      </div>
      <Skeleton
        className={
          multiline
            ? "h-32 w-full rounded-xl md:h-40"
            : "h-11 w-full rounded-xl"
        }
      />
    </div>
  );
}

function SidebarSkeleton() {
  return (
    <div className="flex flex-col gap-4 md:gap-6">
      <section className="rounded-[1.25rem] border border-dashed border-zinc-300 bg-zinc-50 p-3 dark:border-border dark:bg-muted/70 md:rounded-[1.75rem] md:p-6">
        <div className="flex min-h-32 flex-col items-center justify-center rounded-2xl border border-zinc-200 bg-white px-4 py-5 dark:border-border dark:bg-card md:min-h-56 md:rounded-[1.5rem] md:px-6 md:py-10">
          <Skeleton className="size-11 rounded-full md:size-14" />
          <Skeleton className="mt-2 h-5 w-28 md:mt-4 md:h-6" />
          <Skeleton className="mt-2 h-3 w-44 max-w-full md:h-4" />
        </div>
      </section>

      <section className="space-y-3 rounded-[1.25rem] border border-zinc-200 bg-zinc-50 p-3 dark:border-border dark:bg-muted/70 md:space-y-5 md:rounded-[1.75rem] md:p-6">
        <FieldSkeleton />

        <div className="flex items-start gap-3 rounded-xl border border-zinc-200 bg-white p-3 dark:border-white/10 dark:bg-card md:rounded-2xl md:p-4">
          <Skeleton className="size-5 shrink-0 rounded-md" />
          <div className="min-w-0 flex-1 space-y-2">
            <Skeleton className="h-4 w-28" />
            <Skeleton className="h-3 w-4/5" />
          </div>
        </div>

        <div className="hidden rounded-2xl border border-zinc-200 bg-white p-4 dark:border-white/10 dark:bg-card md:block">
          <Skeleton className="h-4 w-32" />
          <div className="mt-3 flex gap-2">
            <Skeleton className="h-6 w-12 rounded-full" />
            <Skeleton className="h-6 w-24 rounded-full" />
          </div>
          <Skeleton className="mt-3 h-3 w-full" />
        </div>

        <div className="hidden rounded-2xl border border-zinc-200 bg-white p-4 dark:border-white/10 dark:bg-card md:block">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="mt-3 h-3 w-full" />
          <Skeleton className="mt-2 h-3 w-3/4" />
        </div>
      </section>
    </div>
  );
}

export function ListingFormSkeleton({ mode = "create" }) {
  const isCreate = mode === "create";

  return (
    <main
      aria-busy="true"
      aria-label={isCreate ? "Loading listing form" : "Loading listing editor"}
      className="min-h-screen bg-zinc-100 px-4 py-3 dark:bg-background md:p-8"
    >
      <div className="mx-auto flex w-full max-w-[1440px] flex-col gap-4 md:gap-8">
        <section className="overflow-hidden rounded-[1.5rem] border border-zinc-200 bg-white shadow-sm dark:border-border dark:bg-card md:rounded-[2rem]">
          <header className="border-b border-zinc-200 px-4 py-4 dark:border-border sm:px-6 sm:py-5 md:px-8 md:py-7">
            <div
              className={
                isCreate
                  ? "flex flex-col gap-3 md:gap-4 lg:flex-row lg:items-start lg:justify-between"
                  : "space-y-2"
              }
            >
              <div className="space-y-2">
                <Skeleton className="h-8 w-52 md:h-10 md:w-64" />
                <Skeleton className="h-4 w-full max-w-2xl" />
                <Skeleton className="h-4 w-3/4 max-w-xl md:hidden" />
              </div>

              {isCreate ? (
                <div className="w-full max-w-md rounded-xl border border-amber-200 bg-amber-50 p-3 dark:border-amber-900/60 dark:bg-amber-950/40 md:rounded-2xl md:px-4">
                  <div className="flex items-start gap-3">
                    <Skeleton className="size-4 shrink-0 rounded-full" />
                    <div className="min-w-0 flex-1 space-y-2">
                      <Skeleton className="h-4 w-40 max-w-full" />
                      <Skeleton className="h-3 w-full" />
                      <Skeleton className="h-3 w-4/5" />
                    </div>
                  </div>
                </div>
              ) : null}
            </div>
          </header>

          <div className="p-4 sm:p-6 md:p-8">
            <Skeleton className="mb-4 h-3 w-full max-w-2xl md:mb-6 md:h-4" />
            <div className="grid gap-5 pb-24 md:gap-8 md:pb-0 xl:grid-cols-[minmax(0,1fr)_minmax(288px,0.85fr)]">
              <div className="space-y-4 md:space-y-5">
                <FieldSkeleton />
                <FieldSkeleton />
                <FieldSkeleton />
                <FieldSkeleton multiline />
                <FieldSkeleton />
              </div>

              <SidebarSkeleton />
            </div>

            <div className="sticky bottom-[calc(4rem+env(safe-area-inset-bottom))] z-30 -mx-4 mt-5 grid grid-cols-2 gap-2 border-t border-zinc-200 bg-white/95 px-4 py-3 backdrop-blur dark:border-border dark:bg-card/95 md:static md:mx-0 md:mt-8 md:flex md:items-center md:justify-end md:gap-3 md:border-0 md:bg-transparent md:p-0 md:backdrop-blur-none">
              <Skeleton className="h-9 w-full rounded-lg md:h-11 md:w-28" />
              <Skeleton className="h-9 w-full rounded-lg md:h-11 md:w-36" />
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
