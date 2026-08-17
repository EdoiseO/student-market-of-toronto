import { cookies } from "next/headers";

import { Skeleton } from "@/components/ui/skeleton";
import { translations } from "@/lib/translations";

export default async function AdminConversationDetailLoading() {
  const cookieStore = await cookies();
  const language = cookieStore.get("language")?.value === "fr" ? "fr" : "en";
  const t = translations[language] || translations.en;

  return (
    <main
      aria-busy="true"
      aria-label={`${t.loading} ${t.adminConversationReviewBadge}`}
      className="min-h-screen overflow-x-hidden bg-zinc-100 px-3 py-4 dark:bg-background sm:px-5 md:p-6 lg:p-7"
    >
      <div className="mx-auto flex w-full max-w-[1360px] flex-col gap-4">
        <div className="flex items-center justify-between gap-3">
          <Skeleton className="h-10 w-44 rounded-full" />
          <Skeleton className="h-7 w-32 rounded-full" />
        </div>
        <section className="overflow-hidden rounded-[1.75rem] border border-border bg-card shadow-sm md:rounded-[2rem]">
          <div className="flex flex-col gap-4 px-4 py-5 md:flex-row md:justify-between md:px-7 md:py-6">
            <div className="min-w-0 flex-1 space-y-3">
              <Skeleton className="h-6 w-20 rounded-full" />
              <Skeleton className="h-9 w-[30rem] max-w-full" />
              <Skeleton className="h-3 w-64 max-w-full" />
            </div>
            <div className="flex gap-2">
              <Skeleton className="h-11 w-36 rounded-xl" />
              <Skeleton className="h-11 w-32 rounded-xl" />
            </div>
          </div>
          <div className="grid gap-3 border-t border-border bg-muted/15 p-4 sm:grid-cols-2 lg:grid-cols-4 lg:px-7">
            {Array.from({ length: 4 }, (_, index) => (
              <Skeleton key={index} className="h-20 rounded-2xl" />
            ))}
          </div>
        </section>
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1.5fr)_minmax(320px,0.7fr)]">
          <section className="overflow-hidden rounded-[1.75rem] border border-border bg-card shadow-sm md:rounded-[2rem]">
            <div className="space-y-2 border-b border-border px-5 py-5">
              <Skeleton className="h-6 w-48" />
              <Skeleton className="h-4 w-80 max-w-full" />
            </div>
            <div className="space-y-3 p-4">
              {Array.from({ length: 5 }, (_, index) => (
                <div key={index} className="flex gap-3 rounded-2xl border border-border p-4">
                  <Skeleton className="size-9 shrink-0 rounded-full" />
                  <div className="min-w-0 flex-1 space-y-2">
                    <Skeleton className="h-4 w-32" />
                    <Skeleton className="h-4 w-4/5" />
                    <Skeleton className="h-3 w-24" />
                  </div>
                </div>
              ))}
            </div>
          </section>
          <aside className="space-y-4">
            <Skeleton className="h-52 rounded-[1.75rem]" />
            <Skeleton className="h-64 rounded-[1.75rem]" />
          </aside>
        </div>
      </div>
    </main>
  );
}
