import { Skeleton } from "@/components/ui/skeleton";

export default function AdminEnforcementLoading() {
  return (
    <main aria-busy="true" aria-label="Loading enforcement" className="min-h-screen bg-zinc-100 px-3 py-4 dark:bg-background sm:px-5 lg:p-8">
      <div className="mx-auto flex w-full max-w-[1280px] flex-col gap-4 sm:gap-5">
        <section className="rounded-2xl border border-border bg-card p-4 sm:rounded-3xl sm:p-6">
          <Skeleton className="h-8 w-28 rounded-full" />
          <div className="mt-4 flex gap-3">
            <Skeleton className="size-10 shrink-0 rounded-2xl" />
            <div className="w-full space-y-2"><Skeleton className="h-8 w-52" /><Skeleton className="h-4 w-full max-w-xl" /></div>
          </div>
        </section>
        <section className="grid gap-2 rounded-2xl border border-border bg-card p-3 sm:grid-cols-2 sm:rounded-3xl sm:p-5 lg:grid-cols-5">
          {Array.from({ length: 5 }, (_, index) => <Skeleton key={index} className="h-10 rounded-xl" />)}
        </section>
        <section className="overflow-hidden rounded-2xl border border-border bg-card sm:rounded-3xl">
          {Array.from({ length: 6 }, (_, index) => (
            <div key={index} className="space-y-2 border-b border-border p-4 sm:p-5">
              <Skeleton className="h-5 w-40" /><Skeleton className="h-4 w-64 max-w-full" /><Skeleton className="h-4 w-full max-w-xl" />
            </div>
          ))}
        </section>
      </div>
    </main>
  );
}
