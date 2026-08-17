import { cookies } from "next/headers";

import { Skeleton } from "@/components/ui/skeleton";
import { translations } from "@/lib/translations";

export default async function AdminConversationsLoading() {
  const cookieStore = await cookies();
  const language = cookieStore.get("language")?.value === "fr" ? "fr" : "en";
  const t = translations[language] || translations.en;

  return (
    <main
      aria-busy="true"
      aria-label={`${t.loading} ${t.adminConversationsTitle}`}
      className="min-h-screen overflow-x-hidden bg-zinc-100 px-3 py-4 dark:bg-background sm:px-5 md:p-6 lg:p-7"
    >
      <div className="mx-auto flex w-full max-w-[1360px] flex-col gap-4">
        <section className="rounded-[1.75rem] border border-border bg-card px-4 py-5 shadow-sm md:rounded-[2rem] md:px-7 md:py-6">
          <Skeleton className="h-9 w-40 rounded-full" />
          <div className="mt-4 flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0 flex-1 space-y-3">
              <Skeleton className="h-8 w-72 max-w-full" />
              <Skeleton className="h-4 w-[34rem] max-w-full" />
            </div>
            <Skeleton className="h-20 w-28 rounded-2xl" />
          </div>
        </section>
        <section className="overflow-hidden rounded-[1.75rem] border border-border bg-card shadow-sm md:rounded-[2rem]">
          <div className="space-y-3 border-b border-border px-4 py-4 md:px-6">
            <div className="flex gap-2 overflow-hidden">
              {Array.from({ length: 5 }, (_, index) => (
                <Skeleton key={index} className="h-9 w-24 shrink-0 rounded-full" />
              ))}
            </div>
            <Skeleton className="h-11 w-full rounded-full" />
          </div>
          <div className="space-y-3 p-3 lg:hidden">
            {Array.from({ length: 4 }, (_, index) => (
              <div key={index} className="space-y-3 rounded-2xl border border-border p-4">
                <div className="flex items-center gap-3">
                  <Skeleton className="size-9 rounded-full" />
                  <Skeleton className="h-4 flex-1" />
                  <Skeleton className="h-6 w-16 rounded-full" />
                </div>
                <Skeleton className="h-16 w-full rounded-xl" />
                <Skeleton className="h-10 w-full rounded-xl" />
              </div>
            ))}
          </div>
          <div className="hidden lg:block">
            {Array.from({ length: 7 }, (_, index) => (
              <div key={index} className="grid grid-cols-5 gap-4 border-b border-border px-6 py-5 last:border-0">
                {Array.from({ length: 5 }, (__, columnIndex) => (
                  <Skeleton key={columnIndex} className="h-4 w-4/5" />
                ))}
              </div>
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}
