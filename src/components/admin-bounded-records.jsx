import Link from "next/link";
import { ArrowUpRight, Inbox, TriangleAlert } from "lucide-react";
import { AdminQueueHeader } from "@/components/admin-queue-header";
import { ClientFormattedDateTime } from "@/components/client-formatted-date-time";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { translations } from "@/lib/translations";

export function AdminBoundedRecords({ title, description, rows, empty, language, pagination, filters = null, totalCount, loadError = false, retryHref, clearHref }) {
  const t = translations[language] || translations.en;
  return (
    <main className="min-h-screen bg-zinc-100 px-4 py-4 dark:bg-background sm:p-5 md:p-6">
      <div className="mx-auto w-full min-w-0 max-w-[1100px] space-y-4">
        <AdminQueueHeader title={title} description={description} count={loadError ? undefined : totalCount} t={t} />
        {filters}
        <section className="min-w-0 rounded-2xl border border-border bg-card" aria-label={title}>
          {loadError ? (
            <div role="alert" className="flex flex-col items-center gap-3 px-4 py-10 text-center">
              <TriangleAlert className="size-6 text-muted-foreground" aria-hidden="true" />
              <p className="max-w-md text-sm text-muted-foreground">{t.adminRegistryLoadError}</p>
              {retryHref ? <Button asChild variant="outline"><a href={retryHref}>{t.adminQueueRetry}</a></Button> : null}
            </div>
          ) : rows.length ? (
            <ul className="divide-y divide-border">
              {rows.map((row) => (
                <li key={row.id} id={`record-${row.id}`} className="min-w-0 scroll-mt-40">
                  <Link href={row.href} className="group flex min-w-0 items-start gap-3 rounded-xl px-4 py-4 transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:px-5">
                    <div className="min-w-0 flex-1">
                      <p className="break-words text-base font-semibold leading-6 [overflow-wrap:anywhere]">{row.title}</p>
                      <div className="mt-2 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1.5">
                        {row.badge ? <Badge variant="outline" className="max-w-full whitespace-normal break-words rounded-md text-xs">{row.badge}</Badge> : null}
                        {row.meta ? <span className="break-words text-xs text-muted-foreground">{row.meta}</span> : null}
                        <ClientFormattedDateTime value={row.createdAt} language={language} className="text-xs text-muted-foreground" />
                      </div>
                      {row.description ? <p className="mt-2 line-clamp-2 break-words text-sm leading-5 text-muted-foreground">{row.description}</p> : null}
                    </div>
                    <ArrowUpRight className="mt-1 size-4 shrink-0 text-muted-foreground group-hover:text-foreground" aria-hidden="true" />
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <div className="flex flex-col items-center gap-3 px-4 py-10 text-center">
              <Inbox className="size-6 text-muted-foreground" aria-hidden="true" />
              <p className="max-w-md text-sm text-muted-foreground">{empty}</p>
              {clearHref ? <Button asChild variant="outline"><Link href={clearHref}>{t.adminQueueClearFilters}</Link></Button> : null}
            </div>
          )}
        </section>
        {!loadError && pagination?.totalPages > 1 ? <nav aria-label={pagination.label} className="flex flex-wrap items-center justify-between gap-3">
          {pagination.page <= 1 ? <Button type="button" variant="outline" disabled>{pagination.previous}</Button> : <Button asChild variant="outline"><Link href={pagination.previousHref}>{pagination.previous}</Link></Button>}
          <p className="text-sm tabular-nums text-muted-foreground">{pagination.page} / {pagination.totalPages}</p>
          {pagination.page >= pagination.totalPages ? <Button type="button" variant="outline" disabled>{pagination.next}</Button> : <Button asChild variant="outline"><Link href={pagination.nextHref}>{pagination.next}</Link></Button>}
        </nav> : null}
      </div>
    </main>
  );
}
