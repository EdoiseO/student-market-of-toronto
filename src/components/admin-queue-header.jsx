import Link from "next/link";

export function AdminQueueHeader({ title, description, count, t }) {
  return (
    <header className="min-w-0 py-1 sm:rounded-2xl sm:border sm:border-border sm:bg-card sm:p-5">
      <Link href="/admin" className="inline-flex min-h-11 items-center text-sm text-muted-foreground underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        {t.adminQueueBreadcrumb}
      </Link>
      <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
        <h1 className="min-w-0 break-words text-[1.625rem] font-bold leading-tight tracking-tight sm:text-3xl">{title}</h1>
        {typeof count === "number" ? <span className="rounded-full bg-muted px-2.5 py-1 text-sm font-medium tabular-nums" aria-label={`${count} ${t.adminQueueResults}`}>{count}</span> : null}
      </div>
      <p className="mt-2 hidden max-w-3xl text-sm leading-6 text-muted-foreground sm:block">{description}</p>
    </header>
  );
}
