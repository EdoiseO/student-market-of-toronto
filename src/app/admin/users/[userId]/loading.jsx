import { Skeleton } from "@/components/ui/skeleton";

export default function AdminUserDetailLoading() {
  return (
    <main className="min-h-screen bg-zinc-100 px-3 py-4 dark:bg-background sm:px-5 lg:p-8">
      <div className="mx-auto flex w-full max-w-[1280px] flex-col gap-4">
        <section className="rounded-2xl border border-border bg-card p-4 sm:rounded-3xl sm:p-6">
          <Skeleton className="h-8 w-28 rounded-full" />
          <Skeleton className="mt-5 h-9 w-64 max-w-full" />
          <Skeleton className="mt-2 h-4 w-80 max-w-full" />
          <div className="mt-5 grid grid-cols-2 gap-2 lg:grid-cols-4">
            {Array.from({ length: 4 }, (_, index) => <Skeleton key={index} className="h-20 rounded-2xl" />)}
          </div>
        </section>
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
          <section className="space-y-3 rounded-2xl border border-border bg-card p-4 sm:rounded-3xl sm:p-5">
            {Array.from({ length: 4 }, (_, index) => <Skeleton key={index} className="h-36 rounded-2xl" />)}
          </section>
          <Skeleton className="h-80 rounded-3xl" />
        </div>
      </div>
    </main>
  );
}
