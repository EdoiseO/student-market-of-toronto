import { AdminBoundedRecords } from "@/components/admin-bounded-records";
import { AdminQueueFilters } from "@/components/admin-queue-filters";
import { adminReviewHref } from "@/lib/admin-queue-navigation.mjs";
import { requireAdminPageAction } from "@/lib/admin-page-access";
import { REPORT_REASON_VALUES, REPORT_STATUS_VALUES, REPORT_SUBJECT_TYPES, getTranslatedReportReason, getTranslatedReportStatus, getTranslatedReportSubjectType } from "@/lib/moderation";
import { MODERATION_ACTIONS } from "@/lib/moderation-policy.mjs";

const PAGE_SIZE = 25;

export default async function AdminReportsPage({ searchParams }) {
  const { admin, language, t } = await requireAdminPageAction(MODERATION_ACTIONS.readReports, "admin report registry");
  const params = await searchParams;
  const page = Math.max(1, Number.parseInt(params?.page, 10) || 1);
  const status = Object.values(REPORT_STATUS_VALUES).includes(params?.status) ? params.status : "open";
  const subject = Object.values(REPORT_SUBJECT_TYPES).includes(params?.subject) ? params.subject : "";
  const reason = Object.values(REPORT_REASON_VALUES).includes(params?.reason) ? params.reason : "";
  const queryText = (params?.q ?? "").trim().slice(0, 80).replace(/[%_,().]/g, " ").replace(/\s+/g, " ").trim();
  const from = (page - 1) * PAGE_SIZE;
  let reportQuery = admin.from("reports").select("id, subject_type, reason, details, status, created_at", { count: "exact" }).eq("status", status).order("created_at", { ascending: false }).order("id", { ascending: false }).range(from, from + PAGE_SIZE - 1);
  if (subject) reportQuery = reportQuery.eq("subject_type", subject);
  if (reason) reportQuery = reportQuery.eq("reason", reason);
  if (queryText) reportQuery = reportQuery.or(`reason.ilike.%${queryText}%,details.ilike.%${queryText}%`);
  const { data, error, count } = await reportQuery;
  if (error) console.error("Failed to load admin reports registry:", error.message);
  const filterParams = new URLSearchParams();
  filterParams.set("status", status); if (subject) filterParams.set("subject", subject); if (reason) filterParams.set("reason", reason); if (queryText) filterParams.set("q", queryText);
  const pageHref = (nextPage) => { const next = new URLSearchParams(filterParams); next.set("page", String(nextPage)); return `/admin/reports?${next}`; };
  const rows = (data ?? []).map((row) => ({
    id: row.id,
    href: adminReviewHref(`/admin/reports/${row.id}`, pageHref(page), row.id),
    title: getTranslatedReportReason(row.reason, t, row.subject_type),
    badge: getTranslatedReportStatus(row.status, t),
    meta: getTranslatedReportSubjectType(row.subject_type, t),
    description: row.details || null,
    createdAt: row.created_at,
  }));
  const filters = <AdminQueueFilters action="/admin/reports" search={queryText} searchLabel={t.adminSearchReportsPlaceholder} maxLength={80} quickFilter="status" fields={[
    { name: "status", label: t.adminFilterStatus, value: status, options: Object.values(REPORT_STATUS_VALUES).map((value) => ({ value, label: getTranslatedReportStatus(value, t) })) },
    { name: "subject", label: t.adminFilterSubject, value: subject, options: [{ value: "", label: t.all }, ...Object.values(REPORT_SUBJECT_TYPES).map((value) => ({ value, label: getTranslatedReportSubjectType(value, t) }))] },
    { name: "reason", label: t.adminFilterReason, value: reason, options: [{ value: "", label: t.all }, ...Object.values(REPORT_REASON_VALUES).map((value) => ({ value, label: getTranslatedReportReason(value, t) }))] },
  ]} />;
  return <AdminBoundedRecords title={t.adminReports} description={t.adminReportsRegistryDescription} rows={rows} empty={t.adminNoReportsMatchFilters} language={language} filters={filters} totalCount={count ?? 0} loadError={Boolean(error)} retryHref={pageHref(page)} clearHref={queryText || subject || reason || status !== "open" ? "/admin/reports" : undefined} pagination={{ page, totalPages: Math.max(1, Math.ceil((count ?? 0) / PAGE_SIZE)), label: t.adminReports, previousHref: pageHref(page - 1), nextHref: pageHref(page + 1), previous: t.previousPage, next: t.nextPage }} />;
}
