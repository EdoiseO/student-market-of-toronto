import { AdminBoundedRecords } from "@/components/admin-bounded-records";
import { AdminQueueFilters } from "@/components/admin-queue-filters";
import { getTranslatedListingApprovalStatus } from "@/lib/listing-approval";
import { adminReviewHref } from "@/lib/admin-queue-navigation.mjs";
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
  const filterParams = new URLSearchParams({ status: queueStatus });
  if (queryText) filterParams.set("q", queryText);
  const pageHref = (nextPage) => {
    const next = new URLSearchParams(filterParams);
    next.set("page", String(nextPage));
    return `/admin/listings?${next}`;
  };
  const rows = (data ?? []).map((row) => ({
    id: row.id,
    href: adminReviewHref(`/admin/listings/${row.id}`, pageHref(page), row.id),
    title: row.title ?? t.listing,
    badge: getTranslatedListingApprovalStatus(row.status, t, row),
    description: row.moderation_feedback || null,
    createdAt: queueStatus === "pending" ? row.submitted_for_review_at ?? row.created_at : row.moderation_reviewed_at ?? row.created_at,
  }));
  const filters = <AdminQueueFilters action="/admin/listings" search={queryText} searchLabel={t.adminSearchListingApprovalsPlaceholder} maxLength={80} quickFilter="status" fields={[
    { name: "status", label: t.adminListingQueueFilter, value: queueStatus, options: [
      { value: "pending", label: t.adminListingQueuePending },
      { value: "approved", label: t.adminListingQueueApproved },
      { value: "rejected", label: t.adminListingQueueRejected },
    ] },
  ]} />;
  return <AdminBoundedRecords title={t.adminListings} description={t.adminListingsRegistryDescription} rows={rows} empty={t.adminNoPendingListingApprovals} language={language} filters={filters} totalCount={count ?? 0} loadError={Boolean(error)} retryHref={pageHref(page)} clearHref={queryText || queueStatus !== "pending" ? "/admin/listings" : undefined} pagination={{ page, totalPages: Math.max(1, Math.ceil((count ?? 0) / PAGE_SIZE)), label: t.adminListings, previousHref: pageHref(page - 1), nextHref: pageHref(page + 1), previous: t.previousPage, next: t.nextPage }} />;
}
