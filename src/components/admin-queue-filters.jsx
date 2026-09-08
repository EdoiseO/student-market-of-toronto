"use client";

import { useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Search, SlidersHorizontal, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Sheet, SheetTrigger, SheetContent, SheetTitle, SheetDescription, SheetClose } from "@/components/ui/sheet";
import { useLanguage } from "@/context/LanguageContext";

export function AdminQueueFilters({ action, search = "", searchLabel, fields = [], quickFilter, hint, maxLength = 100 }) {
  const { t } = useLanguage();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const searchRef = useRef(null);
  const filterKey = JSON.stringify(fields.map(({ name, value }) => [name, value]));
  const quickField = fields.find((field) => field.name === quickFilter);
  const activeCount = fields.filter((field) => field.value !== (field.defaultValue ?? field.options[0]?.value)).length;

  function navigate(event, fromSheet = false) {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    if (fromSheet) values.set("q", searchRef.current?.value ?? search);
    const params = new URLSearchParams();
    for (const [name, value] of values) if (String(value).trim()) params.set(name, String(value).trim());
    setOpen(false);
    startTransition(() => router.push(`${action}?${params}`, { scroll: false }));
  }

  function quickHref(value) {
    const params = new URLSearchParams();
    if (search) params.set("q", search);
    fields.forEach((field) => { if (field.value) params.set(field.name, field.value); });
    params.set(quickFilter, value);
    return `${action}?${params}`;
  }

  return (
    <section aria-label={t.adminQueueFilters} aria-busy={pending} className="min-w-0 space-y-3">
      <div className="flex min-w-0 items-start gap-2">
        <form action={action} method="get" onSubmit={navigate} role="search" className="relative min-w-0 flex-1">
          {fields.map((field) => <input key={field.name} type="hidden" name={field.name} value={field.value} />)}
          <Input key={search} ref={searchRef} type="search" name="q" defaultValue={search} maxLength={maxLength} placeholder={t.adminQueueSearch} aria-label={searchLabel} className="h-11 rounded-xl bg-card pr-12 text-base" />
          <button type="submit" disabled={pending} aria-label={t.adminQueueSearch} className="absolute right-0 top-0 grid size-11 place-items-center rounded-r-xl text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"><Search className="size-4" aria-hidden="true" /></button>
        </form>
        {fields.length > 0 ? <Sheet open={open} onOpenChange={setOpen}>
          <SheetTrigger asChild><Button variant="outline" className="h-11 shrink-0 gap-2 rounded-xl px-3" aria-label={t.adminQueueFilters}><SlidersHorizontal className="size-4" aria-hidden="true" /><span>{t.adminQueueFilters}</span>{activeCount > 0 ? <span className="rounded-full bg-foreground px-1.5 text-xs text-background">{activeCount}</span> : null}</Button></SheetTrigger>
          <SheetContent side="bottom" showCloseButton={false} className="mx-auto max-h-[85dvh] max-w-xl gap-0 overflow-y-auto rounded-t-2xl pb-[max(1rem,env(safe-area-inset-bottom))]">
            <div className="flex items-start justify-between gap-3 border-b border-border p-4">
              <div><SheetTitle className="text-xl font-semibold">{t.adminQueueFilters}</SheetTitle><SheetDescription className="mt-1">{t.adminQueueFilterDescription}</SheetDescription></div>
              <SheetClose asChild><Button variant="ghost" size="icon" className="size-11 shrink-0" aria-label={t.adminQueueCloseFilters}><X className="size-5" aria-hidden="true" /></Button></SheetClose>
            </div>
            <form key={`${filterKey}-${open}`} action={action} method="get" onSubmit={(event) => navigate(event, true)} className="space-y-5 p-4">
              {fields.map((field) => <label key={field.name} className="grid min-w-0 gap-2 text-sm font-medium"><span>{field.label}</span><NativeSelect name={field.name} defaultValue={field.value} className="w-full">{field.options.map((option) => <NativeSelectOption key={option.value} value={option.value}>{option.label}</NativeSelectOption>)}</NativeSelect></label>)}
              <div className="flex flex-wrap gap-2 pt-1"><SheetClose asChild><Button type="button" variant="outline" className="min-h-11 flex-1">{t.cancel}</Button></SheetClose><Button type="submit" disabled={pending} className="min-h-11 flex-1">{t.adminQueueShowResults}</Button></div>
            </form>
          </SheetContent>
        </Sheet> : null}
      </div>
      {quickField ? <nav aria-label={quickField.label} className="flex min-w-0 flex-wrap gap-1.5">{quickField.options.map((option) => <Link key={option.value} href={quickHref(option.value)} scroll={false} aria-current={quickField.value === option.value ? "page" : undefined} className={`inline-flex min-h-11 items-center rounded-full border px-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${quickField.value === option.value ? "border-foreground bg-foreground text-background" : "border-border bg-card text-muted-foreground hover:text-foreground"}`}>{option.label}</Link>)}</nav> : null}
      {hint ? <p className="text-xs leading-5 text-muted-foreground">{hint}</p> : null}
      <span className="sr-only" role="status" aria-live="polite">{pending ? t.loading : ""}</span>
    </section>
  );
}
