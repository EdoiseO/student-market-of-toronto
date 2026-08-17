import Link from "next/link";

import { ClientFormattedDateTime } from "@/components/client-formatted-date-time";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export function AdminBoundedRecords({ title, description, rows, empty, language, pagination, filters = null }) {
  return (
    <main className="min-h-screen bg-zinc-100 p-3 dark:bg-background sm:p-5 md:p-6">
      <div className="mx-auto w-full max-w-[1100px] space-y-4">
        <header className="rounded-3xl border border-border bg-card p-5 shadow-sm sm:p-6"><h1 className="text-2xl font-bold tracking-tight sm:text-3xl">{title}</h1><p className="mt-1 max-w-3xl text-sm leading-6 text-muted-foreground">{description}</p></header>
        {filters}
        <section className="space-y-2 rounded-3xl border border-border bg-card p-3 shadow-sm sm:p-4" aria-label={title}>
          {rows.length ? rows.map((row) => <Link key={row.id} href={row.href} className="flex min-w-0 items-center justify-between gap-3 rounded-2xl border border-border p-3 hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:p-4"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><p className="truncate font-medium">{row.title}</p>{row.badge ? <Badge variant="outline">{row.badge}</Badge> : null}</div><p className="mt-1 line-clamp-2 break-words text-sm text-muted-foreground">{row.description}</p></div><ClientFormattedDateTime value={row.createdAt} language={language} className="shrink-0 text-xs text-muted-foreground" /></Link>) : <div className="rounded-2xl border border-dashed border-border px-4 py-12 text-center text-sm text-muted-foreground">{empty}</div>}
        </section>
        {pagination.totalPages > 1 ? <nav aria-label={pagination.label} className="flex items-center justify-between gap-3">{pagination.page <= 1 ? <Button type="button" variant="outline" size="sm" disabled>{pagination.previous}</Button> : <Button asChild variant="outline" size="sm"><Link href={pagination.previousHref}>{pagination.previous}</Link></Button>}<p className="text-sm text-muted-foreground">{pagination.page} / {pagination.totalPages}</p>{pagination.page >= pagination.totalPages ? <Button type="button" variant="outline" size="sm" disabled>{pagination.next}</Button> : <Button asChild variant="outline" size="sm"><Link href={pagination.nextHref}>{pagination.next}</Link></Button>}</nav> : null}
      </div>
    </main>
  );
}
