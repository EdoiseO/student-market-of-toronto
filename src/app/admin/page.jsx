import Link from "next/link";
import { AlertTriangle, Ban, CircleAlert, Clock3, FileWarning, Gavel, MessageSquareOff, ShieldAlert } from "lucide-react";

import { requireAdminPageAction } from "@/lib/admin-page-access";
import { ClientFormattedDateTime } from "@/components/client-formatted-date-time";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { MODERATION_ACTIONS, canPerformModerationAction } from "@/lib/moderation-policy.mjs";

const ATTENTION_LIMIT = 4;
const TIMELINE_LIMIT = 10;

async function countQuery(query, label) {
  const { count, error } = await query;
  if (error) {
    console.error(`Failed to load ${label}:`, error.message);
    return { value: null, available: false };
  }
  return { value: count ?? 0, available: true };
}

async function rowsQuery(query, label) {
  const { data, error } = await query;
  if (error) {
    console.error(`Failed to load ${label}:`, error.message);
    return { rows: [], available: false };
  }
  return { rows: data ?? [], available: true };
}

function MetricCard({ icon: Icon, label, metric, href }) {
  return (
    <Link href={href} className="group min-w-0 rounded-2xl border border-border bg-card p-4 transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">{label}</span>
        <Icon className="size-4 shrink-0 text-muted-foreground group-hover:text-foreground" />
      </div>
      <p className="mt-2 text-2xl font-semibold tabular-nums text-foreground">{metric.available ? metric.value : "—"}</p>
    </Link>
  );
}

export default async function AdminPage() {
  const { admin, language, role, t } = await requireAdminPageAction(MODERATION_ACTIONS.viewDashboard);

  const canReadReports = canPerformModerationAction(role, MODERATION_ACTIONS.readReports);
  const canReadListings = canPerformModerationAction(role, MODERATION_ACTIONS.readListings);
  const canReadUsers = canPerformModerationAction(role, MODERATION_ACTIONS.readUsers);
  const canReadConversations = canPerformModerationAction(role, MODERATION_ACTIONS.readConversations);
  const canReadAudit = canPerformModerationAction(role, MODERATION_ACTIONS.readAuditLog);
  const now = new Date().toISOString();
  const unavailable = { value: null, available: false };

  const unavailableRows = { rows: [], available: false };
  const [openReports, pendingListings, activeStrikes, unacknowledgedWarnings, closedChats, activeRestrictions, reports, listings, reviews, conversations, audit] = await Promise.all([
    canReadReports ? countQuery(admin.from("reports").select("id", { count: "exact", head: true }).eq("status", "open"), "open report count") : unavailable,
    canReadListings ? countQuery(admin.from("listings").select("id", { count: "exact", head: true }).eq("status", "inactive").not("submitted_for_review_at", "is", null), "pending listing count") : unavailable,
    canReadUsers ? countQuery(admin.from("moderation_sanctions").select("id", { count: "exact", head: true }).eq("sanction_type", "strike").is("revoked_at", null).or(`expires_at.is.null,expires_at.gt.${now}`), "active strike count") : unavailable,
    canReadUsers ? countQuery(admin.from("moderation_sanctions").select("id", { count: "exact", head: true }).eq("sanction_type", "warning").eq("acknowledgement_required", true).is("acknowledged_at", null).is("revoked_at", null).or(`expires_at.is.null,expires_at.gt.${now}`), "unacknowledged warning count") : unavailable,
    canReadConversations ? countQuery(admin.from("conversation_effective_moderation_state").select("conversation_id", { count: "exact", head: true }).eq("effective_status", "closed"), "closed conversation count") : unavailable,
    canReadUsers ? countQuery(admin.from("moderation_sanctions").select("id", { count: "exact", head: true }).is("revoked_at", null).neq("restrictions", "{}").or(`expires_at.is.null,expires_at.gt.${now}`), "active restriction count") : unavailable,
    canReadReports ? rowsQuery(admin.from("reports").select("id, subject_type, reason, created_at").eq("status", "open").order("created_at", { ascending: false }).limit(ATTENTION_LIMIT), "report attention queue") : unavailableRows,
    canReadListings ? rowsQuery(admin.from("listings").select("id, title, submitted_for_review_at").eq("status", "inactive").not("submitted_for_review_at", "is", null).order("submitted_for_review_at", { ascending: true, nullsFirst: false }).limit(ATTENTION_LIMIT), "listing attention queue") : unavailableRows,
    canReadUsers ? rowsQuery(admin.from("moderation_sanctions").select("id, subject_user_id_snapshot, sanction_type, review_requested_at").eq("review_status", "pending").order("review_requested_at", { ascending: true }).limit(ATTENTION_LIMIT), "review attention queue") : unavailableRows,
    canReadConversations ? rowsQuery(admin.from("conversation_effective_moderation_state").select("conversation_id, closed_until, changed_at").eq("effective_status", "closed").order("changed_at", { ascending: false }).limit(ATTENTION_LIMIT), "conversation attention queue") : unavailableRows,
    canReadAudit ? rowsQuery(admin.from("moderation_audit_events").select("id, event_type, summary, occurred_at").order("occurred_at", { ascending: false }).order("id", { ascending: false }).limit(TIMELINE_LIMIT), "moderation audit timeline") : unavailableRows,
  ]);

  const attentionUnavailable = [
    canReadReports && reports,
    canReadListings && listings,
    canReadUsers && reviews,
    canReadConversations && conversations,
  ].some((queue) => queue && !queue.available);

  const attention = [
    ...reports.rows.map((row) => ({ id: `report:${row.id}`, title: row.reason, description: row.subject_type, href: `/admin/reports/${row.id}`, createdAt: row.created_at, kind: t.adminAttentionReport })),
    ...listings.rows.map((row) => ({ id: `listing:${row.id}`, title: row.title ?? t.listing, description: t.adminAttentionListing, href: `/admin/listings/${row.id}`, createdAt: row.submitted_for_review_at, kind: t.adminAttentionListing })),
    ...reviews.rows.map((row) => ({ id: `review:${row.id}`, title: `${row.sanction_type} · ${row.subject_user_id_snapshot}`, description: t.adminAttentionAppeal, href: `/admin/users/${row.subject_user_id_snapshot}`, createdAt: row.review_requested_at, kind: t.adminAttentionAppeal })),
    ...conversations.rows.map((row) => ({ id: `conversation:${row.conversation_id}`, title: t.adminAttentionClosedChat, description: row.closed_until ? t.adminAttentionTemporaryClose : t.adminAttentionIndefiniteClose, href: `/admin/conversations/${row.conversation_id}`, createdAt: row.changed_at, kind: t.adminAttentionClosedChat })),
  ].sort((a, b) => new Date(a.createdAt ?? 0).getTime() - new Date(b.createdAt ?? 0).getTime()).slice(0, 12);

  const metrics = [
    canReadReports && { icon: FileWarning, label: t.adminMetricOpenReports, metric: openReports, href: "/admin/reports" },
    canReadListings && { icon: Clock3, label: t.adminMetricPendingListings, metric: pendingListings, href: "/admin/listings" },
    canReadUsers && { icon: Gavel, label: t.adminMetricActiveStrikes, metric: activeStrikes, href: "/admin/enforcement?type=strike&status=active" },
    canReadUsers && { icon: CircleAlert, label: t.adminMetricUnackWarnings, metric: unacknowledgedWarnings, href: "/admin/enforcement?type=warning&status=active" },
    canReadConversations && { icon: MessageSquareOff, label: t.adminMetricClosedChats, metric: closedChats, href: "/admin/conversations?status=closed" },
    canReadUsers && { icon: Ban, label: t.adminMetricActiveRestrictions, metric: activeRestrictions, href: "/admin/enforcement?status=active" },
  ].filter(Boolean);

  return (
    <main className="min-h-screen bg-zinc-100 p-3 dark:bg-background sm:p-5 md:p-6">
      <div className="mx-auto w-full max-w-[1360px] space-y-5">
        <header className="rounded-3xl border border-border bg-card p-5 shadow-sm sm:p-6">
          <Badge variant="secondary" className="rounded-full">{t.adminOverview}</Badge>
          <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div className="min-w-0"><h1 className="text-2xl font-bold tracking-tight sm:text-3xl">{t.adminDashboard}</h1><p className="mt-1 max-w-2xl text-sm leading-6 text-muted-foreground">{t.adminOverviewDescription}</p></div>
            {role === "admin" ? <Button asChild className="w-full rounded-xl sm:w-auto"><Link href="/admin/announcements">{t.adminCreateAnnouncement}</Link></Button> : null}
          </div>
        </header>

        <section aria-labelledby="admin-metrics-title"><h2 id="admin-metrics-title" className="sr-only">{t.adminMetricsTitle}</h2><div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">{metrics.map((metric) => <MetricCard key={metric.label} {...metric} />)}</div></section>

        <div className={canReadAudit ? "grid gap-5 lg:grid-cols-[minmax(0,1.25fr)_minmax(320px,.75fr)]" : "grid gap-5"}>
          <section className="min-w-0 rounded-3xl border border-border bg-card p-4 shadow-sm sm:p-5" aria-labelledby="attention-title">
            <div className="flex items-center gap-2"><AlertTriangle className="size-5" /><h2 id="attention-title" className="text-lg font-semibold">{t.adminNeedsAttention}</h2></div><p className="mt-1 text-sm text-muted-foreground">{t.adminNeedsAttentionDescription}</p>
            <div className="mt-4 space-y-2">
              {attentionUnavailable ? <p role="status" className="rounded-2xl border border-border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">{attention.length ? t.adminNeedsAttentionPartial : t.adminNeedsAttentionUnavailable}</p> : null}
              {attention.length ? attention.map((item) => <Link key={item.id} href={item.href} className="flex min-w-0 items-center justify-between gap-3 rounded-2xl border border-border p-3 hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><div className="min-w-0"><p className="truncate text-sm font-medium">{item.title}</p><p className="truncate text-xs text-muted-foreground">{item.description}</p></div><div className="shrink-0 text-right"><Badge variant="outline" className="max-w-28 truncate">{item.kind}</Badge><ClientFormattedDateTime value={item.createdAt} language={language} className="mt-1 block text-[11px] text-muted-foreground" /></div></Link>) : attentionUnavailable ? null : <div className="rounded-2xl border border-dashed border-border px-4 py-10 text-center text-sm text-muted-foreground">{t.adminNeedsAttentionEmpty}</div>}
            </div>
          </section>

          {canReadAudit ? <section className="min-w-0 rounded-3xl border border-border bg-card p-4 shadow-sm sm:p-5" aria-labelledby="timeline-title"><div className="flex items-center justify-between gap-2"><div className="flex items-center gap-2"><ShieldAlert className="size-5" /><h2 id="timeline-title" className="text-lg font-semibold">{t.adminRecentEnforcement}</h2></div><Button asChild variant="ghost" size="sm"><Link href="/admin/audit">{t.viewAll}</Link></Button></div><div className="mt-4 space-y-3">{!audit.available ? <p role="status" className="text-sm text-muted-foreground">{t.adminRecentEnforcementUnavailable}</p> : audit.rows.length ? audit.rows.map((event) => <div key={event.id} className="border-l-2 border-border pl-3"><p className="text-sm font-medium">{event.summary}</p><p className="mt-0.5 text-xs text-muted-foreground">{event.event_type} · <ClientFormattedDateTime value={event.occurred_at} language={language} /></p></div>) : <p className="text-sm text-muted-foreground">{t.adminRecentEnforcementEmpty}</p>}</div></section> : null}
        </div>
      </div>
    </main>
  );
}
