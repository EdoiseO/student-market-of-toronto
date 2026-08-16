import { AdminBoundedRecords } from "@/components/admin-bounded-records";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { requireAdminPageAction } from "@/lib/admin-page-access";
import { REPORT_REASON_VALUES, REPORT_STATUS_VALUES, REPORT_SUBJECT_TYPES } from "@/lib/moderation";
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
  const rows = (data ?? []).map((row) => ({ id: row.id, href: `/admin/reports/${row.id}`, title: row.reason, badge: row.status, description: row.details || row.subject_type, createdAt: row.created_at }));
  const filterParams = new URLSearchParams();
  filterParams.set("status", status); if (subject) filterParams.set("subject", subject); if (reason) filterParams.set("reason", reason); if (queryText) filterParams.set("q", queryText);
  const pageHref = (nextPage) => { const next = new URLSearchParams(filterParams); next.set("page", String(nextPage)); return `/admin/reports?${next}`; };
  const filters = <form method="get" className="grid gap-2 rounded-3xl border border-border bg-card p-3 shadow-sm sm:grid-cols-2 lg:grid-cols-5"><Input name="q" defaultValue={queryText} placeholder={t.adminSearchReportsPlaceholder} aria-label={t.adminSearchReportsPlaceholder} /><NativeSelect name="status" defaultValue={status} aria-label={t.adminFilterStatus}><NativeSelectOption value="open">{t.adminEnforcementActive}</NativeSelectOption><NativeSelectOption value="resolved">{t.resolve}</NativeSelectOption><NativeSelectOption value="dismissed">{t.dismiss}</NativeSelectOption></NativeSelect><NativeSelect name="subject" defaultValue={subject} aria-label={t.adminFilterSubject}><NativeSelectOption value="">{t.all}</NativeSelectOption>{Object.values(REPORT_SUBJECT_TYPES).map((value) => <NativeSelectOption key={value} value={value}>{value}</NativeSelectOption>)}</NativeSelect><NativeSelect name="reason" defaultValue={reason} aria-label={t.adminFilterReason}><NativeSelectOption value="">{t.all}</NativeSelectOption>{Object.values(REPORT_REASON_VALUES).map((value) => <NativeSelectOption key={value} value={value}>{value}</NativeSelectOption>)}</NativeSelect><Button type="submit">{t.applyFilters}</Button></form>;
  return <AdminBoundedRecords title={t.adminReports} description={t.adminReportsRegistryDescription} rows={rows} empty={error ? t.adminRegistryLoadError : t.adminNoReportsMatchFilters} language={language} filters={filters} pagination={{ page, totalPages: Math.max(1, Math.ceil((count ?? 0) / PAGE_SIZE)), label: t.adminReports, previousHref: pageHref(page - 1), nextHref: pageHref(page + 1), previous: t.previousPage, next: t.nextPage }} />;
}
