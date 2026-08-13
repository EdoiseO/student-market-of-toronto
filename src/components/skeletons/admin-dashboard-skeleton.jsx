import { Skeleton } from "@/components/ui/skeleton";

function AdminPageHeadingSkeleton({ withEyebrow = false, actionCount = 2 }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div className="min-w-0 space-y-3">
        {withEyebrow ? <Skeleton className="h-7 w-36 rounded-full" /> : null}
        <Skeleton className="h-9 w-56 max-w-full" />
        <Skeleton className="h-4 w-[28rem] max-w-full" />
      </div>
      <div className="flex flex-wrap gap-2">
        {Array.from({ length: actionCount }, (_, index) => (
          <Skeleton key={index} className="h-10 w-28 rounded-xl" />
        ))}
      </div>
    </div>
  );
}

function AdminSummarySkeleton({ withIcon = true }) {
  return (
    <div className="rounded-3xl border border-border bg-card px-6 py-5 shadow-xs">
      <div className="flex items-center gap-4">
        {withIcon ? <Skeleton className="size-11 shrink-0 rounded-2xl" /> : null}
        <div className="min-w-0 flex-1 space-y-2.5">
          <Skeleton className="h-3.5 w-24 max-w-full" />
          <Skeleton className="h-7 w-12" />
          <Skeleton className="h-3 w-32 max-w-full" />
        </div>
      </div>
    </div>
  );
}

function AdminMobileRowSkeleton() {
  return (
    <div className="space-y-3 rounded-2xl border border-border bg-background p-4 lg:hidden">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1 space-y-2">
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="h-3 w-5/6" />
        </div>
        <Skeleton className="h-6 w-16 rounded-full" />
      </div>
      <div className="flex items-center justify-between gap-3">
        <Skeleton className="h-3 w-24" />
        <Skeleton className="h-9 w-20 rounded-xl" />
      </div>
    </div>
  );
}

function AdminDesktopTableSkeleton({ rows = 4, columns = 5 }) {
  return (
    <div className="hidden overflow-hidden rounded-2xl border border-border lg:block">
      <div
        className="grid gap-4 border-b border-border bg-muted/25 px-4 py-3"
        style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
      >
        {Array.from({ length: columns }, (_, index) => (
          <Skeleton key={index} className="h-3 w-16 max-w-full" />
        ))}
      </div>
      {Array.from({ length: rows }, (_, rowIndex) => (
        <div
          key={rowIndex}
          className="grid items-center gap-4 border-b border-border px-4 py-4 last:border-b-0"
          style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
        >
          {Array.from({ length: columns }, (_, columnIndex) => (
            <Skeleton
              key={columnIndex}
              className={columnIndex === columns - 1 ? "ml-auto h-9 w-20 rounded-xl" : "h-4 w-4/5"}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

function AdminFilterSkeleton({ pills = 4 }) {
  return (
    <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
      <div className="flex flex-wrap gap-2">
        {Array.from({ length: pills }, (_, index) => (
          <Skeleton key={index} className="h-8 w-20 rounded-full" />
        ))}
      </div>
      <Skeleton className="h-10 w-full rounded-full lg:max-w-sm" />
    </div>
  );
}

function AdminQueueSectionSkeleton({ pills = 0, rows = 4 }) {
  return (
    <div className="overflow-hidden rounded-3xl border border-border bg-card shadow-sm">
      <div className="space-y-3 border-b border-border px-5 py-5 md:px-6 md:py-6">
        <Skeleton className="h-7 w-48 max-w-full" />
        <Skeleton className="h-4 w-80 max-w-full" />
        <div className="pt-1">
          {pills > 0 ? <AdminFilterSkeleton pills={pills} /> : <Skeleton className="h-10 w-full rounded-full lg:max-w-sm" />}
        </div>
      </div>
      <div className="space-y-3 px-5 py-5 md:px-6 md:py-6">
        {Array.from({ length: Math.min(rows, 3) }, (_, index) => (
          <AdminMobileRowSkeleton key={index} />
        ))}
        <AdminDesktopTableSkeleton rows={rows} columns={5} />
      </div>
    </div>
  );
}

function AdminReviewToolbarSkeleton() {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <Skeleton className="h-9 w-44 rounded-full" />
      <Skeleton className="h-8 w-40 rounded-full" />
    </div>
  );
}

function AdminReviewMetadataSkeleton({ items }) {
  return (
    <div className="overflow-hidden rounded-[2rem] border border-zinc-200 bg-white shadow-sm dark:border-border dark:bg-card">
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-zinc-200 px-5 py-5 dark:border-border md:px-6">
        <div className="space-y-3">
          <div className="flex gap-2">
            <Skeleton className="h-6 w-20 rounded-full" />
            <Skeleton className="h-6 w-24 rounded-full" />
          </div>
          <Skeleton className="h-7 w-64 max-w-full" />
          <Skeleton className="h-4 w-80 max-w-full" />
        </div>
        <div className="space-y-2">
          <Skeleton className="ml-auto h-3 w-24" />
          <Skeleton className="h-4 w-32" />
        </div>
      </div>
      <div
        className={`grid gap-4 px-5 py-5 md:grid-cols-2 md:px-6 ${
          items < 6 ? "xl:grid-cols-4" : "xl:grid-cols-6"
        }`}
      >
        {Array.from({ length: items }, (_, index) => (
          <div key={index}>
            <Skeleton className="mb-2 h-3 w-20" />
            <Skeleton className="h-4 w-32 max-w-full" />
          </div>
        ))}
      </div>
    </div>
  );
}

function AdminReviewWorkspaceSkeleton({ messageRows = false }) {
  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1.45fr)_minmax(300px,0.8fr)]">
      <section className="overflow-hidden rounded-[2rem] border border-zinc-200 bg-white shadow-sm dark:border-border dark:bg-card">
        <div className="space-y-2 border-b border-zinc-200 px-5 py-5 dark:border-border md:px-6">
          <Skeleton className="h-5 w-44" />
          <Skeleton className="h-3.5 w-72 max-w-full" />
        </div>
        <div className="space-y-4 bg-zinc-50/70 px-5 py-5 dark:bg-muted/20 md:px-6">
          {messageRows ? (
            Array.from({ length: 4 }, (_, index) => (
              <div key={index} className="flex items-start gap-3 rounded-2xl border border-border bg-card p-4">
                <Skeleton className="size-10 shrink-0 rounded-full" />
                <div className="min-w-0 flex-1 space-y-2">
                  <Skeleton className="h-3.5 w-28" />
                  <Skeleton className="h-4 w-4/5" />
                  <Skeleton className="h-3 w-20" />
                </div>
              </div>
            ))
          ) : (
            <>
              <div className="rounded-[1.75rem] border border-border bg-card p-5">
                <div className="flex items-center gap-4">
                  <Skeleton className="size-20 shrink-0 rounded-2xl" />
                  <div className="min-w-0 flex-1 space-y-3">
                    <Skeleton className="h-5 w-2/3" />
                    <Skeleton className="h-4 w-2/5" />
                    <Skeleton className="h-3.5 w-1/2" />
                  </div>
                </div>
              </div>
              <div className="rounded-[1.75rem] border border-border bg-card p-5">
                <Skeleton className="mb-4 h-5 w-32" />
                <div className="space-y-2.5">
                  <Skeleton className="h-3.5 w-full" />
                  <Skeleton className="h-3.5 w-11/12" />
                  <Skeleton className="h-3.5 w-3/4" />
                </div>
              </div>
            </>
          )}
        </div>
        <div className="flex flex-wrap justify-end gap-2 border-t border-zinc-200 px-5 py-5 dark:border-border md:px-6">
          <Skeleton className="h-10 w-24 rounded-xl" />
          <Skeleton className="h-10 w-24 rounded-xl" />
        </div>
      </section>

      <div className="space-y-4">
        {Array.from({ length: 2 }, (_, index) => (
          <div key={index} className="overflow-hidden rounded-[2rem] border border-zinc-200 bg-white shadow-sm dark:border-border dark:bg-card">
            <div className="border-b border-zinc-200 px-5 py-5 dark:border-border md:px-6">
              <Skeleton className="h-5 w-40" />
            </div>
            <div className="space-y-3 px-5 py-5 md:px-6">
              <Skeleton className="h-4 w-4/5" />
              <Skeleton className="h-4 w-3/5" />
              <Skeleton className="h-10 w-full rounded-xl" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function AdminDashboardSkeleton() {
  return (
    <div aria-hidden="true" className="overflow-hidden rounded-[2rem] border border-zinc-200 bg-white shadow-sm dark:border-border dark:bg-card">
      <div className="border-b border-zinc-200 px-5 py-5 dark:border-border md:px-6 lg:px-7">
        <AdminPageHeadingSkeleton />
      </div>
      <div className="space-y-6 p-5 md:p-8 md:pt-6">
        <div className="grid grid-cols-1 gap-4 @xl/main:grid-cols-2 @5xl/main:grid-cols-5">
          {Array.from({ length: 5 }, (_, index) => (
            <AdminSummarySkeleton key={index} />
          ))}
        </div>
        <AdminQueueSectionSkeleton pills={4} />
        <AdminQueueSectionSkeleton />
        <AdminQueueSectionSkeleton />
        <AdminQueueSectionSkeleton />
      </div>
    </div>
  );
}

export function AdminUsersSkeleton() {
  return (
    <div aria-hidden="true" className="overflow-hidden rounded-[2rem] border border-zinc-200 bg-white shadow-sm dark:border-border dark:bg-card">
      <div className="border-b border-zinc-200 px-5 py-5 dark:border-border md:px-6 lg:px-7">
        <AdminPageHeadingSkeleton withEyebrow actionCount={1} />
      </div>
      <div className="space-y-6 p-5 md:p-8 md:pt-6">
        <div className="grid gap-4 @xl/main:grid-cols-2 @4xl/main:grid-cols-3">
          {Array.from({ length: 3 }, (_, index) => (
            <AdminSummarySkeleton key={index} withIcon={false} />
          ))}
        </div>
        <div className="rounded-3xl border border-border bg-card p-5 shadow-sm md:p-6">
          <div className="mb-6">
            <AdminFilterSkeleton />
          </div>
          <div className="space-y-3">
            {Array.from({ length: 4 }, (_, index) => (
              <AdminMobileRowSkeleton key={index} />
            ))}
            <AdminDesktopTableSkeleton rows={5} columns={6} />
          </div>
        </div>
      </div>
    </div>
  );
}

export function AdminListingReviewSkeleton() {
  return (
    <div aria-hidden="true" className="flex flex-col gap-3">
      <AdminReviewToolbarSkeleton />
      <div className="flex flex-col gap-4">
        <AdminReviewMetadataSkeleton items={4} />
        <AdminReviewWorkspaceSkeleton />
      </div>
    </div>
  );
}

export function AdminReportReviewSkeleton() {
  return (
    <div aria-hidden="true" className="flex flex-col gap-3">
      <AdminReviewToolbarSkeleton />
      <div className="flex flex-col gap-4">
        <AdminReviewMetadataSkeleton items={6} />
        <AdminReviewWorkspaceSkeleton messageRows />
      </div>
    </div>
  );
}
