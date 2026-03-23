import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { CheckIcon, LoaderCircleIcon } from "lucide-react";

import { createClient } from "@/utils/supabase/server";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DashboardListingActions } from "@/components/dashboard-listing-actions";

const dashboardTabs = [
  { key: "all", label: "All" },
  { key: "active", label: "Active" },
  { key: "inactive", label: "Inactive" },
  { key: "sold", label: "Sold" },
  { key: "draft", label: "Draft" },
  { key: "favourite", label: "Favourite" },
];

const rowsPerPageOptions = [7, 10, 15];

const statusBadgeClasses = {
  active: "border-zinc-200 bg-white text-zinc-700",
  inactive: "border-zinc-200 bg-white text-zinc-700",
  draft: "border-zinc-200 bg-zinc-100 text-zinc-700",
  sold: "border-zinc-200 bg-zinc-100 text-zinc-700",
  favourite: "border-rose-200 bg-rose-50 text-rose-700",
};

const statusLabels = {
  active: "Live",
  inactive: "Pending Approval",
  draft: "Draft",
  sold: "Sold",
  favourite: "Favourite",
};

function buildDashboardHref(tab) {
  return tab === "all" ? "/dashboard" : `/dashboard?tab=${tab}`;
}

function buildDashboardPageHref(tab, page, rows) {
  const params = new URLSearchParams();

  if (tab !== "all") params.set("tab", tab);
  if (page > 1) params.set("page", String(page));
  if (rows !== 7) params.set("rows", String(rows));

  const query = params.toString();
  return query ? `/dashboard?${query}` : "/dashboard";
}

const readOnlyTabs = new Set(["favourite", "sold"]);
const editableStatuses = new Set(["active", "inactive", "draft"]);

function DashboardStatusBadge({ status }) {
  if (status === "active") {
    return (
      <Badge variant="outline" className={statusBadgeClasses[status]}>
        <span className="mr-1.5 inline-flex h-4 w-4 items-center justify-center rounded-full bg-emerald-500 text-white">
          <CheckIcon className="size-3" />
        </span>
        {statusLabels[status]}
      </Badge>
    );
  }

  if (status === "inactive") {
    return (
      <Badge variant="outline" className={statusBadgeClasses[status]}>
        <LoaderCircleIcon className="mr-1.5 size-3.5 animate-spin text-zinc-500" />
        {statusLabels[status]}
      </Badge>
    );
  }

  return (
    <Badge variant="outline" className={statusBadgeClasses[status]}>
      {statusLabels[status]}
    </Badge>
  );
}

export default async function DashboardPage({ searchParams }) {
  const resolvedSearchParams = await searchParams;
  const requestedTab = resolvedSearchParams?.tab ?? "all";
  const currentTab = dashboardTabs.some((tab) => tab.key === requestedTab)
    ? requestedTab
    : "all";

  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const [
    { data: myListings, error: listingsError },
    { data: favourites, error: favouritesError },
  ] = await Promise.all([
    supabase
      .from("listings")
      .select("id, slug, title, price, category, status, location, created_at")
      .eq("seller_id", user.id)
      .order("created_at", { ascending: false }),
    supabase
      .from("listing_favourites")
      .select(
        "listing_id, listings(id, slug, title, price, category, status, location)",
      )
      .eq("user_id", user.id),
  ]);

  if (listingsError || favouritesError) {
    console.error("Dashboard query failed", {
      listingsError,
      favouritesError,
    });
  }

  const ownedItems = (myListings ?? []).map((listing) => ({
    id: listing.id,
    slug: listing.slug,
    title: listing.title,
    meta: listing.location ?? "",
    price: `$${Number(listing.price).toFixed(2)}`,
    category: listing.category,
    dashboardStatus: listing.status,
    messageCount: 0,
  }));

  const favouriteItems = (favourites ?? [])
    .map((favourite) =>
      Array.isArray(favourite.listings)
        ? favourite.listings[0]
        : favourite.listings,
    )
    .filter(Boolean)
    .map((listing) => ({
      id: listing.id,
      slug: listing.slug,
      title: listing.title,
      meta: listing.location ?? "",
      price: `$${Number(listing.price).toFixed(2)}`,
      category: listing.category,
      dashboardStatus: "favourite",
      messageCount: 0,
    }));

  const allItems = ownedItems;

  const filteredItems =
    currentTab === "all"
      ? allItems
      : currentTab === "favourite"
        ? favouriteItems
        : ownedItems.filter((item) => item.dashboardStatus === currentTab);

  const requestedRows = Number.parseInt(resolvedSearchParams?.rows ?? "7", 10);
  const rowsPerPage = rowsPerPageOptions.includes(requestedRows)
    ? requestedRows
    : 7;
  const totalPages = Math.max(1, Math.ceil(filteredItems.length / rowsPerPage));
  const requestedPage = Number.parseInt(resolvedSearchParams?.page ?? "1", 10);
  const currentPage =
    Number.isNaN(requestedPage) || requestedPage < 1
      ? 1
      : Math.min(requestedPage, totalPages);

  const paginatedItems = filteredItems.slice(
    (currentPage - 1) * rowsPerPage,
    currentPage * rowsPerPage,
  );

  const counts = dashboardTabs.reduce((acc, tab) => {
    if (tab.key === "all") {
      acc[tab.key] = allItems.length;
    } else if (tab.key === "favourite") {
      acc[tab.key] = favouriteItems.length;
    } else {
      acc[tab.key] = ownedItems.filter(
        (item) => item.dashboardStatus === tab.key,
        ).length;
    }
    return acc;
  }, {});

  const showManagementActions = !readOnlyTabs.has(currentTab);

  return (
    <main className="min-h-screen bg-zinc-100 p-6 md:p-8">
      <div className="mx-auto flex w-full max-w-[1800px] flex-col gap-8">
        <Card className="rounded-[2rem] border-zinc-200 bg-white py-0 shadow-sm">
          <CardHeader className="border-b border-zinc-200 px-8 py-6">
            <CardTitle className="text-4xl font-bold tracking-tight text-zinc-950">
              Dashboard
            </CardTitle>
            <p className="max-w-2xl text-base text-zinc-600">
              Track live listings, pending approvals, sold items, drafts, and
              saved items in one place.
            </p>
          </CardHeader>

          <CardContent className="space-y-5 p-8 pt-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap gap-2.5">
                {dashboardTabs.map((tab) => {
                  const isActive = currentTab === tab.key;
                  return (
                    <Button
                      key={tab.key}
                      asChild
                      variant={isActive ? "default" : "outline"}
                      size="sm"
                      className={
                        isActive
                          ? "h-10 rounded-xl px-4"
                          : "h-10 rounded-xl bg-white px-4"
                      }
                    >
                      <Link href={buildDashboardHref(tab.key)}>
                        <span>{tab.label}</span>
                        <span
                          className={`ml-1 rounded-full px-2 py-0.5 text-xs font-semibold ${
                            isActive
                              ? "bg-white/20 text-white"
                              : "bg-black/10 text-zinc-700"
                          }`}
                        >
                          {counts[tab.key]}
                        </span>
                      </Link>
                    </Button>
                  );
                })}
              </div>

              {showManagementActions ? (
                <Button asChild className="h-10 rounded-xl px-4">
                  <Link href="/listings/create">Add Listing</Link>
                </Button>
              ) : null}
            </div>

            <div className="overflow-hidden rounded-[1.75rem] border border-zinc-200 bg-white">
              <div className="overflow-x-auto">
                <table className="min-w-full text-left">
                  <thead className="bg-zinc-50">
                    <tr className="border-b border-zinc-200 text-sm text-zinc-500">
                      <th className="px-6 py-4 font-medium">Listing</th>
                      <th className="px-6 py-4 font-medium">Status</th>
                      <th className="px-6 py-4 font-medium">Price</th>
                      <th className="px-6 py-4 font-medium">Messages</th>
                      <th className="px-6 py-4 font-medium">Category</th>
                      {showManagementActions ? (
                        <th className="px-6 py-4 text-right font-medium">
                          Actions
                        </th>
                      ) : null}
                    </tr>
                  </thead>
                  <tbody>
                    {paginatedItems.map((item) => (
                      <tr
                        key={`${item.dashboardStatus}-${item.id}`}
                        className="border-b border-zinc-200 last:border-b-0"
                      >
                        <td className="px-6 py-5">
                          <Link
                            href={`/listings/${item.slug}`}
                            className="block rounded-xl transition hover:bg-zinc-50"
                          >
                            <div className="py-1">
                              <p className="font-semibold text-zinc-950">
                                {item.title}
                              </p>
                              <p className="mt-1 text-sm text-zinc-500">
                                {item.meta}
                              </p>
                            </div>
                          </Link>
                        </td>
                        <td className="px-6 py-5">
                          <DashboardStatusBadge status={item.dashboardStatus} />
                        </td>
                        <td className="px-6 py-5 font-medium text-zinc-900">
                          {item.price}
                        </td>
                        <td className="px-6 py-5 text-zinc-700">
                          {item.messageCount > 0
                            ? `${item.messageCount}+`
                            : "0"}
                        </td>
                        <td className="px-6 py-5 text-zinc-700">
                          {item.category}
                        </td>
                        {showManagementActions ? (
                          <td className="px-6 py-5 text-right">
                            {editableStatuses.has(item.dashboardStatus) ? (
                              <DashboardListingActions
                                id={item.id}
                                slug={item.slug}
                                status={item.dashboardStatus}
                              />
                            ) : (
                              <span className="text-sm text-zinc-400">-</span>
                            )}
                          </td>
                        ) : null}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {filteredItems.length === 0 ? (
                <div className="px-6 py-12 text-center text-sm text-zinc-500">
                  No listings found for this section yet.
                </div>
              ) : null}

              {filteredItems.length > 7 ? (
                <div className="flex flex-col gap-4 border-t border-zinc-200 px-6 py-4 text-sm text-zinc-500 md:flex-row md:items-center md:justify-between">
                  <p>0 of {filteredItems.length} row(s) selected.</p>
                  <div className="flex flex-col gap-4 md:flex-row md:items-center">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-zinc-700">
                        Rows per page
                      </span>
                      <div className="flex items-center gap-2">
                        {rowsPerPageOptions.map((option) => (
                          <Button
                            key={option}
                            asChild
                            variant={
                              rowsPerPage === option ? "outline" : "ghost"
                            }
                            size="sm"
                            className={
                              rowsPerPage === option
                                ? "h-9 rounded-xl bg-white px-3"
                                : "h-9 rounded-xl px-3"
                            }
                          >
                            <Link
                              href={buildDashboardPageHref(
                                currentTab,
                                1,
                                option,
                              )}
                            >
                              {option}
                            </Link>
                          </Button>
                        ))}
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="font-medium text-zinc-700">
                        Page {currentPage} of {totalPages}
                      </span>
                      <div className="flex items-center gap-2">
                        <Button
                          asChild
                          variant="outline"
                          size="icon-sm"
                          className={
                            currentPage === 1
                              ? "pointer-events-none opacity-50"
                              : ""
                          }
                        >
                          <Link
                            href={buildDashboardPageHref(
                              currentTab,
                              1,
                              rowsPerPage,
                            )}
                          >
                            <span aria-hidden="true">«</span>
                          </Link>
                        </Button>
                        <Button
                          asChild
                          variant="outline"
                          size="icon-sm"
                          className={
                            currentPage === 1
                              ? "pointer-events-none opacity-50"
                              : ""
                          }
                        >
                          <Link
                            href={buildDashboardPageHref(
                              currentTab,
                              Math.max(1, currentPage - 1),
                              rowsPerPage,
                            )}
                          >
                            <span aria-hidden="true">‹</span>
                          </Link>
                        </Button>
                        <Button
                          asChild
                          variant="outline"
                          size="icon-sm"
                          className={
                            currentPage === totalPages
                              ? "pointer-events-none opacity-50"
                              : ""
                          }
                        >
                          <Link
                            href={buildDashboardPageHref(
                              currentTab,
                              Math.min(totalPages, currentPage + 1),
                              rowsPerPage,
                            )}
                          >
                            <span aria-hidden="true">›</span>
                          </Link>
                        </Button>
                        <Button
                          asChild
                          variant="outline"
                          size="icon-sm"
                          className={
                            currentPage === totalPages
                              ? "pointer-events-none opacity-50"
                              : ""
                          }
                        >
                          <Link
                            href={buildDashboardPageHref(
                              currentTab,
                              totalPages,
                              rowsPerPage,
                            )}
                          >
                            <span aria-hidden="true">»</span>
                          </Link>
                        </Button>
                      </div>
                    </div>
                  </div>
                </div>
              ) : null}
            </div>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
