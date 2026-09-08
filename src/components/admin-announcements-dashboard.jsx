"use client";

import * as React from "react";
import { CalendarClock, LoaderCircle, Megaphone, RefreshCw, Send, TriangleAlert } from "lucide-react";
import { toast } from "sonner";

import { ClientFormattedDateTime } from "@/components/client-formatted-date-time";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { useLanguage } from "@/context/LanguageContext";
import {
  ANNOUNCEMENT_AUDIENCE_ROLES,
  ANNOUNCEMENT_AUDIENCE_TYPES,
  ANNOUNCEMENT_CATEGORIES,
  ANNOUNCEMENT_DELIVERY_POLICIES,
  ANNOUNCEMENT_MESSAGE_MAX_LENGTH,
  ANNOUNCEMENT_PRIORITIES,
  ANNOUNCEMENT_STATUSES,
} from "@/lib/admin-announcements.mjs";

const EMPTY_FORM = Object.freeze({
  title: "", body: "", category: "general", priority: "normal",
  audienceType: "all", audienceValues: "", deliveryPolicy: "always_on",
});

function operationFor(ref, payload) {
  const key = JSON.stringify(payload);
  if (ref.current?.key !== key) ref.current = { key, id: crypto.randomUUID() };
  return ref.current.id;
}

function audienceFilter(form) {
  const values = form.audienceValues.split(",").map((value) => value.trim()).filter(Boolean);
  if (form.audienceType === "school") return { schools: values };
  if (form.audienceType === "role") return { roles: values };
  if (form.audienceType === "selected") return { user_ids: values };
  return {};
}

function statusLabel(status, t) {
  return t[`adminAnnouncementStatus_${status}`] ?? status;
}

function AnnouncementCard({ announcement, onAction, onEdit, busy, t, language }) {
  const [scheduledFor, setScheduledFor] = React.useState("");
  const isDraft = announcement.status === "draft";
  const canCancel = ["scheduled", "sending"].includes(announcement.status);
  const canRetry = announcement.status === "partially_failed";

  return (
    <article className="min-w-0 rounded-3xl border border-border bg-card p-4 shadow-sm sm:p-5">
      <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0"><div className="flex flex-wrap gap-2"><Badge>{statusLabel(announcement.status, t)}</Badge><Badge variant="outline">{announcement.priority}</Badge><Badge variant="outline">{announcement.audienceType}</Badge></div><h2 className="mt-3 break-words text-lg font-semibold">{announcement.title}</h2><p className="mt-1 line-clamp-2 break-words text-sm text-muted-foreground">{announcement.body}</p></div>
        <p className="shrink-0 text-xs text-muted-foreground"><ClientFormattedDateTime value={announcement.updatedAt} language={language} /></p>
      </div>

      <div className="mt-4 grid grid-cols-3 gap-2 text-center sm:grid-cols-6">
        {[[t.adminAnnouncementRecipients, announcement.recipientCount], [t.adminAnnouncementDelivered, announcement.deliveredCount], [t.adminAnnouncementFailed, announcement.failedCount], [t.adminAnnouncementSkipped, announcement.skippedCount], [t.adminAnnouncementRead, announcement.readCount], [t.adminAnnouncementDismissed, announcement.dismissedCount]].map(([label, value]) => <div key={label} className="rounded-xl bg-muted/60 p-2"><p className="text-lg font-semibold tabular-nums">{value}</p><p className="truncate text-[11px] text-muted-foreground">{label}</p></div>)}
      </div>

      {announcement.recipientCount > 0 ? <div className="mt-3"><div className="h-2 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-foreground" style={{ width: `${announcement.progressPercent}%` }} /></div><p className="mt-1 text-xs text-muted-foreground">{t.adminAnnouncementProgress.replace("{count}", String(announcement.progressPercent))}</p></div> : null}

      {announcement.scheduledFor ? <p className="mt-3 flex items-center gap-2 text-sm text-muted-foreground"><CalendarClock className="size-4" />{t.adminAnnouncementScheduledFor} <ClientFormattedDateTime value={announcement.scheduledFor} language={language} /></p> : null}

      <div className="mt-4 flex flex-wrap gap-2">
        {isDraft ? <><Button type="button" variant="outline" size="sm" onClick={() => onEdit(announcement)} disabled={busy}>{t.edit}</Button><Button type="button" size="sm" onClick={() => onAction("send", announcement)} disabled={busy}><Send className="size-4" />{t.adminAnnouncementSendNow}</Button></> : null}
        {announcement.status === "scheduled" ? <Button type="button" variant="outline" size="sm" onClick={() => onAction("unschedule", announcement)} disabled={busy}>{t.adminAnnouncementUnschedule}</Button> : null}
        {canCancel ? <Button type="button" variant="destructive" size="sm" onClick={() => onAction("cancel", announcement)} disabled={busy}>{t.cancel}</Button> : null}
        {canRetry ? <Button type="button" variant="outline" size="sm" onClick={() => onAction("retry", announcement)} disabled={busy}><RefreshCw className="size-4" />{t.adminAnnouncementRetry}</Button> : null}
      </div>

      {isDraft ? <div className="mt-3 flex flex-col gap-2 rounded-2xl border border-border p-3 sm:flex-row sm:items-end"><div className="min-w-0 flex-1"><Label htmlFor={`schedule-${announcement.id}`}>{t.adminAnnouncementScheduleTime}</Label><Input id={`schedule-${announcement.id}`} type="datetime-local" value={scheduledFor} onChange={(event) => setScheduledFor(event.target.value)} className="mt-1" /></div><Button type="button" variant="outline" onClick={() => onAction("schedule", announcement, { scheduledFor: new Date(scheduledFor).toISOString() })} disabled={busy || !scheduledFor}>{t.adminAnnouncementSchedule}</Button></div> : null}
    </article>
  );
}

export function AdminAnnouncementsDashboard() {
  const { language, t } = useLanguage();
  const [form, setForm] = React.useState(EMPTY_FORM);
  const [editing, setEditing] = React.useState(null);
  const [announcements, setAnnouncements] = React.useState([]);
  const [pagination, setPagination] = React.useState({ page: 1, totalPages: 1, total: 0 });
  const [status, setStatus] = React.useState("");
  const [query, setQuery] = React.useState("");
  const [worker, setWorker] = React.useState({ configured: false, emailAvailable: false });
  const [loading, setLoading] = React.useState(true);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState("");
  const operationRef = React.useRef(null);

  const load = React.useCallback(async (page = 1) => {
    setLoading(true); setError("");
    try {
      const params = new URLSearchParams({ page: String(page) });
      if (status) params.set("status", status);
      if (query.trim()) params.set("q", query.trim());
      const response = await fetch(`/api/admin/announcements?${params}`, { cache: "no-store" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || t.adminAnnouncementsLoadError);
      setAnnouncements(payload.announcements ?? []); setPagination(payload.pagination); setWorker(payload.worker);
    } catch (loadError) { setError(loadError.message || t.adminAnnouncementsLoadError); }
    finally { setLoading(false); }
  }, [query, status, t.adminAnnouncementsLoadError]);

  React.useEffect(() => { const timeout = setTimeout(() => load(1), 180); return () => clearTimeout(timeout); }, [load]);

  function setField(name, value) { operationRef.current = null; setForm((current) => ({ ...current, [name]: value })); }

  async function request(method, payload) {
    setBusy(true);
    try {
      const operationId = operationFor(operationRef, payload);
      const response = await fetch("/api/admin/announcements", { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...payload, operationId }) });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || t.adminAnnouncementActionError);
      operationRef.current = null; toast.success(t.adminAnnouncementActionSuccess); await load(pagination.page); return result;
    } catch (requestError) { toast.error(requestError.message || t.adminAnnouncementActionError); throw requestError; }
    finally { setBusy(false); }
  }

  async function submit(action) {
    const payload = { action, ...form, audienceFilter: audienceFilter(form) };
    if (editing) Object.assign(payload, { action: "update_draft", announcementId: editing.id, expectedVersion: editing.version });
    try { await request(editing ? "PATCH" : "POST", payload); setForm(EMPTY_FORM); setEditing(null); } catch { /* toast handled */ }
  }

  function submitEditor(event) {
    event.preventDefault();
    submit(event.nativeEvent.submitter?.value === "send" ? "send" : "create_draft");
  }

  async function lifecycle(action, announcement, extra = {}) {
    try { await request("PATCH", { action, announcementId: announcement.id, expectedVersion: announcement.version, ...extra }); } catch { /* toast handled */ }
  }

  function edit(announcement) {
    setEditing(announcement); operationRef.current = null;
    setForm({ title: announcement.title, body: announcement.body, category: announcement.category, priority: announcement.priority, audienceType: announcement.audienceType, audienceValues: Object.values(announcement.audienceFilter ?? {}).flat().join(", "), deliveryPolicy: announcement.deliveryPolicy });
    document.getElementById("announcement-editor")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  return (
    <main className="min-h-screen bg-zinc-100 p-3 dark:bg-background sm:p-5 md:p-6">
      <div className="mx-auto w-full max-w-[1360px] space-y-5">
        <header className="rounded-3xl border border-border bg-card p-5 shadow-sm sm:p-6"><div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between"><div><Badge variant="secondary" className="rounded-full"><Megaphone className="mr-1 size-3" />{t.adminNavAnnouncements}</Badge><h1 className="mt-3 text-2xl font-bold sm:text-3xl">{t.adminAnnouncementsTitle}</h1><p className="mt-1 max-w-2xl text-sm leading-6 text-muted-foreground">{t.adminAnnouncementsDescription}</p></div><div className="flex flex-wrap gap-2"><Badge variant={worker.configured ? "default" : "outline"}>{worker.configured ? t.adminAnnouncementWorkerConfigured : t.adminAnnouncementWorkerNeedsScheduler}</Badge><Button type="button" variant="outline" size="sm" onClick={() => lifecycle("run_worker", { id: null, version: 1 })} disabled={busy}><RefreshCw className="size-4" />{t.adminAnnouncementRunWorker}</Button></div></div>{!worker.configured ? <div className="mt-4 flex gap-2 rounded-2xl border border-amber-400/40 bg-amber-50 p-3 text-sm text-amber-950 dark:bg-amber-950/20 dark:text-amber-100"><TriangleAlert className="mt-0.5 size-4 shrink-0" /><p>{t.adminAnnouncementWorkerDescription}</p></div> : null}</header>

        <div className="grid items-start gap-5 lg:grid-cols-[minmax(300px,.72fr)_minmax(0,1.28fr)]">
          <section id="announcement-editor" className="rounded-3xl border border-border bg-card p-4 shadow-sm sm:p-5 lg:sticky lg:top-24" aria-labelledby="announcement-editor-title">
            <h2 id="announcement-editor-title" className="text-lg font-semibold">{editing ? t.adminAnnouncementEditDraft : t.adminAnnouncementCreateDraft}</h2>
            <form className="mt-3 space-y-3" onSubmit={submitEditor}>
              <div><Label htmlFor="announcement-title">{t.title}</Label><Input id="announcement-title" value={form.title} onChange={(event) => setField("title", event.target.value)} maxLength={160} required className="mt-1" /></div>
              <div><Label htmlFor="announcement-body">{t.announcementMessageLabel}</Label><Textarea id="announcement-body" value={form.body} onChange={(event) => setField("body", event.target.value)} maxLength={ANNOUNCEMENT_MESSAGE_MAX_LENGTH} required rows={6} className="mt-1 min-h-32 resize-y" /><p className="mt-1 text-right text-xs text-muted-foreground">{Array.from(form.body).length}/{ANNOUNCEMENT_MESSAGE_MAX_LENGTH}</p></div>
              <div className="grid grid-cols-2 gap-3"><div className="min-w-0"><Label htmlFor="announcement-category">{t.category}</Label><NativeSelect id="announcement-category" value={form.category} onChange={(event) => setField("category", event.target.value)} className="mt-1 w-full min-w-0">{ANNOUNCEMENT_CATEGORIES.map((value) => <NativeSelectOption key={value} value={value}>{t[`adminAnnouncementCategory_${value}`] ?? value}</NativeSelectOption>)}</NativeSelect></div><div className="min-w-0"><Label htmlFor="announcement-priority">{t.adminAnnouncementPriority}</Label><NativeSelect id="announcement-priority" value={form.priority} onChange={(event) => setField("priority", event.target.value)} className="mt-1 w-full min-w-0">{ANNOUNCEMENT_PRIORITIES.map((value) => <NativeSelectOption key={value} value={value}>{t[`adminAnnouncementPriority_${value}`] ?? value}</NativeSelectOption>)}</NativeSelect></div></div>
              <div><Label htmlFor="announcement-audience">{t.adminAnnouncementAudience}</Label><NativeSelect id="announcement-audience" value={form.audienceType} onChange={(event) => setField("audienceType", event.target.value)} className="mt-1 w-full min-w-0">{ANNOUNCEMENT_AUDIENCE_TYPES.map((value) => <NativeSelectOption key={value} value={value}>{t[`adminAnnouncementAudience_${value}`] ?? value}</NativeSelectOption>)}</NativeSelect></div>
              {form.audienceType !== "all" ? <div><Label htmlFor="announcement-audience-values">{t.adminAnnouncementAudienceValues}</Label>{form.audienceType === "role" ? <NativeSelect id="announcement-audience-values" value={form.audienceValues} onChange={(event) => setField("audienceValues", event.target.value)} className="mt-1 w-full min-w-0" required><NativeSelectOption value="">{t.adminAnnouncementChooseAudience}</NativeSelectOption>{ANNOUNCEMENT_AUDIENCE_ROLES.map((value) => <NativeSelectOption key={value} value={value}>{t[`adminAnnouncementRole_${value}`] ?? value}</NativeSelectOption>)}</NativeSelect> : <Input id="announcement-audience-values" value={form.audienceValues} onChange={(event) => setField("audienceValues", event.target.value)} placeholder={t.adminAnnouncementAudienceValuesPlaceholder} className="mt-1" required />}<p className="mt-1 text-xs text-muted-foreground">{t.adminAnnouncementAudienceHint}</p></div> : null}
              <div><Label htmlFor="announcement-policy">{t.adminAnnouncementDeliveryPolicy}</Label><NativeSelect id="announcement-policy" aria-describedby="announcement-delivery-help" value={form.deliveryPolicy} onChange={(event) => setField("deliveryPolicy", event.target.value)} className="mt-1 w-full min-w-0">{ANNOUNCEMENT_DELIVERY_POLICIES.map((value) => <NativeSelectOption key={value} value={value}>{t[`adminAnnouncementPolicy_${value}`] ?? value}</NativeSelectOption>)}</NativeSelect><p id="announcement-delivery-help" className="mt-1 text-xs text-muted-foreground">{t.adminAnnouncementEmailUnavailable}{form.deliveryPolicy === "preference_aware" ? <> {t.adminAnnouncementPreferenceUnavailable}</> : null}</p></div>
              <div className="flex flex-col gap-2 sm:flex-row"><Button type="submit" value="create_draft" className="flex-1" disabled={busy}>{busy ? <LoaderCircle className="size-4 animate-spin" /> : null}{editing ? t.saveChanges : t.saveDraft}</Button>{!editing ? <Button type="submit" value="send" variant="outline" className="flex-1" disabled={busy}><Send className="size-4" />{t.adminAnnouncementSendNow}</Button> : <Button type="button" variant="outline" onClick={() => { setEditing(null); setForm(EMPTY_FORM); }}>{t.cancel}</Button>}</div>
            </form>
          </section>

          <section className="min-w-0" aria-labelledby="announcement-history-title"><div className="flex flex-col gap-3 rounded-3xl border border-border bg-card p-4 sm:flex-row sm:items-end sm:justify-between"><div><h2 id="announcement-history-title" className="font-semibold">{t.adminAnnouncementHistory}</h2><p className="text-sm text-muted-foreground">{t.adminAnnouncementTotal.replace("{count}", String(pagination.total))}</p></div><div className="flex min-w-0 flex-col gap-2 sm:flex-row"><Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t.adminAnnouncementSearchPlaceholder} aria-label={t.adminAnnouncementSearchPlaceholder} className="min-w-0 sm:w-56" /><NativeSelect value={status} onChange={(event) => setStatus(event.target.value)} aria-label={t.adminAnnouncementStatusFilter}><NativeSelectOption value="">{t.all}</NativeSelectOption>{ANNOUNCEMENT_STATUSES.map((value) => <NativeSelectOption key={value} value={value}>{statusLabel(value, t)}</NativeSelectOption>)}</NativeSelect></div></div>
            <div className="mt-3 space-y-3">{loading ? <div className="flex min-h-48 items-center justify-center rounded-3xl border border-border bg-card"><LoaderCircle className="size-6 animate-spin" /><span className="sr-only">{t.loading}</span></div> : error ? <div role="alert" className="rounded-3xl border border-destructive/40 bg-card p-6 text-center"><p className="font-medium">{error}</p><Button type="button" variant="outline" className="mt-3" onClick={() => load(pagination.page)}>{t.retry}</Button></div> : announcements.length ? announcements.map((announcement) => <AnnouncementCard key={announcement.id} announcement={announcement} onAction={lifecycle} onEdit={edit} busy={busy} t={t} language={language} />) : <div className="rounded-3xl border border-dashed border-border bg-card px-5 py-12 text-center text-sm text-muted-foreground">{t.adminAnnouncementsEmpty}</div>}</div>
            {pagination.totalPages > 1 ? <nav aria-label={t.adminAnnouncementPagination} className="mt-4 flex items-center justify-between gap-3"><Button type="button" variant="outline" size="sm" disabled={loading || pagination.page <= 1} onClick={() => load(pagination.page - 1)}>{t.previousPage}</Button><p className="text-sm text-muted-foreground">{t.pageLabel} {pagination.page} / {pagination.totalPages}</p><Button type="button" variant="outline" size="sm" disabled={loading || pagination.page >= pagination.totalPages} onClick={() => load(pagination.page + 1)}>{t.nextPage}</Button></nav> : null}
          </section>
        </div>
      </div>
    </main>
  );
}
