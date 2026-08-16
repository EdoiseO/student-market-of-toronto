import { AdminBoundedRecords } from "@/components/admin-bounded-records";
import { requireAdminPageAction } from "@/lib/admin-page-access";
import { MODERATION_ACTIONS } from "@/lib/moderation-policy.mjs";

const PAGE_SIZE = 30;

export default async function AdminAuditPage({ searchParams }) {
  const { admin, language, t } = await requireAdminPageAction(MODERATION_ACTIONS.readAuditLog, "admin audit registry");
  const params = await searchParams;
  const page = Math.max(1, Number.parseInt(params?.page, 10) || 1);
  const from = (page - 1) * PAGE_SIZE;
  const { data, error, count } = await admin.from("moderation_audit_events").select("id, event_type, summary, resource_type, resource_id, occurred_at", { count: "exact" }).order("occurred_at", { ascending: false }).order("id", { ascending: false }).range(from, from + PAGE_SIZE - 1);
  if (error) console.error("Failed to load immutable audit registry:", error.message);
  const rows = (data ?? []).map((row) => ({ id: row.id, href: row.resource_type === "announcement" && row.resource_id ? `/admin/announcements?q=${row.resource_id}` : "/admin/audit", title: row.summary, badge: row.event_type, description: `${row.resource_type}${row.resource_id ? ` · ${row.resource_id}` : ""}`, createdAt: row.occurred_at }));
  return <AdminBoundedRecords title={t.adminAuditTitle} description={t.adminAuditDescription} rows={rows} empty={error ? t.adminRegistryLoadError : t.adminAuditEmpty} language={language} pagination={{ page, totalPages: Math.max(1, Math.ceil((count ?? 0) / PAGE_SIZE)), label: t.adminAuditTitle, previousHref: `/admin/audit?page=${page - 1}`, nextHref: `/admin/audit?page=${page + 1}`, previous: t.previousPage, next: t.nextPage }} />;
}
