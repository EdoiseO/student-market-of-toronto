import { AdminBoundedRecords } from "@/components/admin-bounded-records";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { requireAdminPageAction } from "@/lib/admin-page-access";
import { MODERATION_ACTIONS } from "@/lib/moderation-policy.mjs";

const PAGE_SIZE = 25;

export default async function AdminListingsPage({ searchParams }) {
  const { admin, language, t } = await requireAdminPageAction(MODERATION_ACTIONS.readListings, "admin listing registry");
  const params = await searchParams;
  const page = Math.max(1, Number.parseInt(params?.page, 10) || 1);
  const queueStatus = ["pending", "approved", "rejected"].includes(params?.status) ? params.status : "pending";
  const queryText = (params?.q ?? "").trim().slice(0, 80).replace(/[%_,().]/g, " ").replace(/\s+/g, " ").trim();
  const from = (page - 1) * PAGE_SIZE;
  let listingQuery = admin.from("listings").select("id, title, status, moderation_feedback, submitted_for_review_at, moderation_reviewed_at, created_at", { count: "exact" }).order(queueStatus === "pending" ? "submitted_for_review_at" : "moderation_reviewed_at", { ascending: queueStatus === "pending", nullsFirst: false }).order("id", { ascending: true }).range(from, from + PAGE_SIZE - 1);
  if (queueStatus === "pending") listingQuery = listingQuery.eq("status", "inactive").not("submitted_for_review_at", "is", null);
  if (queueStatus === "approved") listingQuery = listingQuery.eq("status", "active").not("moderation_reviewed_at", "is", null);
  if (queueStatus === "rejected") listingQuery = listingQuery.eq("status", "rejected");
  if (queryText) listingQuery = listingQuery.ilike("title", `%${queryText}%`);
  const { data, error, count } = await listingQuery;
  if (error) console.error("Failed to load admin listing registry:", error.message);
  const rows = (data ?? []).map((row) => ({ id: row.id, href: `/admin/listings/${row.id}`, title: row.title ?? t.listing, badge: row.status, description: row.moderation_feedback || t.adminListingApprovalQueueDescription, createdAt: row.submitted_for_review_at ?? row.created_at }));
  const filterParams = new URLSearchParams({ status: queueStatus }); if (queryText) filterParams.set("q", queryText);
  const pageHref = (nextPage) => { const next = new URLSearchParams(filterParams); next.set("page", String(nextPage)); return `/admin/listings?${next}`; };
  const filters = <form method="get" className="grid gap-2 rounded-3xl border border-border bg-card p-3 shadow-sm sm:grid-cols-[minmax(0,1fr)_auto_auto]"><Input name="q" defaultValue={queryText} placeholder={t.adminSearchListingApprovalsPlaceholder} aria-label={t.adminSearchListingApprovalsPlaceholder} /><NativeSelect name="status" defaultValue={queueStatus} aria-label={t.adminListingQueueFilter}><NativeSelectOption value="pending">{t.adminListingQueuePending}</NativeSelectOption><NativeSelectOption value="approved">{t.adminListingQueueApproved}</NativeSelectOption><NativeSelectOption value="rejected">{t.adminListingQueueRejected}</NativeSelectOption></NativeSelect><Button type="submit">{t.applyFilters}</Button></form>;
  return <AdminBoundedRecords title={t.adminListings} description={t.adminListingsRegistryDescription} rows={rows} empty={error ? t.adminRegistryLoadError : t.adminNoPendingListingApprovals} language={language} filters={filters} pagination={{ page, totalPages: Math.max(1, Math.ceil((count ?? 0) / PAGE_SIZE)), label: t.adminListings, previousHref: pageHref(page - 1), nextHref: pageHref(page + 1), previous: t.previousPage, next: t.nextPage }} />;
}
