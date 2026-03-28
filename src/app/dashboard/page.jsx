import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { CheckIcon } from "lucide-react";

import { createClient } from "@/utils/supabase/server";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DashboardListingActions } from "@/components/dashboard-listing-actions";
import { translations } from "@/lib/translations";

const rowsPerPageOptions = [7, 10, 15];

const statusBadgeClasses = {
  active: "border-zinc-200 bg-white text-zinc-700",
  inactive: "border-zinc-200 bg-white text-zinc-700",
  draft: "border-zinc-200 bg-zinc-100 text-zinc-700",
  sold: "border-zinc-200 bg-zinc-100 text-zinc-700",
  favourite: "border-rose-200 bg-rose-50 text-rose-700",
};

function getCategoryTranslationKey(category) {
  return String(category ?? "")
    .trim()
    .replace(/&/g, "and")
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .split(" ")
    .filter(Boolean)
    .map((word, index) =>
      index === 0
        ? word.toLowerCase()
        : word.charAt(0).toUpperCase() + word.slice(1).toLowerCase(),
    )
    .join("");
}

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

const readOnlyTabs = new Set(["favourite"]);
const editableStatuses = new Set(["active", "inactive", "draft", "sold"]);

function DashboardStatusBadge({ status, labels }) {
  if (status === "active") {
    return (
      <Badge variant="outline" className={statusBadgeClasses[status]}>
        <span className="mr-1.5 inline-flex h-4 w-4 items-center justify-center rounded-full bg-emerald-500 text-white">
          <CheckIcon className="size-3" />
        </span>
        <span className="whitespace-nowrap">{labels[status]}</span>
      </Badge>
    );
  }

  return (
    <Badge variant="outline" className={statusBadgeClasses[status]}>
      <span className="whitespace-nowrap">{labels[status]}</span>
    </Badge>
  );
}

export default async function DashboardPage({ searchParams }) {
  const resolvedSearchParams = await searchParams;
  const cookieStore = await cookies();
  const language = cookieStore.get("language")?.value === "fr" ? "fr" : "en";
  const t = translations[language];

  const dashboardTabs = [
    { key: "all", label: t.all ?? "All" },
    { key: "active", label: t.active ?? "Active" },
    { key: "inactive", label: t.inactive ?? "Inactive" },
    { key: "sold", label: t.sold ?? "Sold" },
    { key: "draft", label: t.draft ?? (language === "fr" ? "Brouillon" : "Draft") },
    { key: "favourite", label: t.favourite ?? t.favourites ?? (language === "fr" ? "Favori" : "Favourite") },
  ];

  const statusLabels = {
    active: t.live ?? (language === "fr" ? "En ligne" : "Live"),
    inactive: t.inactive ?? "Inactive",
    draft: t.draft ?? (language === "fr" ? "Brouillon" : "Draft"),
    sold: t.sold ?? "Sold",
    favourite: t.favourite ?? t.favourites ?? (language === "fr" ? "Favori" : "Favourite"),
  };

  const categoryLabels = {
    services: t.services ?? "Services",
    housing: t.housing ?? "Housing",
    schoolSupplies: t.schoolSupplies ?? "School Supplies",
    furniture: t.furniture ?? "Furniture",
    electronics: t.electronics ?? "Electronics",
    books: t.books ?? "Books",
    sportsAndFitness: t.sportsAndFitness ?? "Sports & Fitness",
    gamesAndEntertainment: t.gamesAndEntertainment ?? "Games & Entertainment",
    clothingAndAccessories: t.clothingAndAccessories ?? "Clothing & Accessories",
    homeAndKitchen: t.homeAndKitchen ?? "Home & Kitchen",
    other: t.other ?? "Other",
  };

  const requestedTab = resolvedSearchParams?.tab ?? "all";
  const currentTab = dashboardTabs.some((tab) => tab.key === requestedTab)
    ? requestedTab
    : "all";

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
              {t.dashboard}
            </CardTitle>
            <p className="max-w-2xl text-base text-zinc-600">
              {t.dashboardDescription ??
                (language === "fr"
                  ? "Suivez les annonces en ligne, inactives, vendues, les brouillons et les favoris au même endroit."
                  : "Track live listings, inactive listings, sold items, drafts, and saved items in one place.")}
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
                  <Link href="/listings/create">{t.addListing ?? t.createListing}</Link>
                </Button>
              ) : null}
            </div>

            <div className="overflow-hidden rounded-[1.75rem] border border-zinc-200 bg-white">
              <div className="overflow-x-auto">
                <table className="min-w-full text-left">
                  <thead className="bg-zinc-50">
                    <tr className="border-b border-zinc-200 text-sm text-zinc-500">
                      <th className="px-6 py-4 font-medium">{t.listing}</th>
                      <th className="px-6 py-4 font-medium">{t.status}</th>
                      <th className="px-6 py-4 font-medium">{t.price}</th>
                      <th className="px-6 py-4 font-medium">{t.messages}</th>
                      <th className="px-6 py-4 font-medium">{t.category}</th>
                      {showManagementActions ? (
                        <th className="px-6 py-4 text-right font-medium">
                          {t.actions}
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
                          <DashboardStatusBadge
                            status={item.dashboardStatus}
                            labels={statusLabels}
                          />
                        </td>
                        <td className="px-6 py-5 font-medium text-zinc-900">
                          {item.price}
                        </td>
                        <td className="px-6 py-5 text-zinc-700">
                          {item.messageCount > 0 ? `${item.messageCount}+` : "0"}
                        </td>
                        <td className="px-6 py-5 text-zinc-700">
                          {categoryLabels[getCategoryTranslationKey(item.category)] ?? item.category}
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
                  {t.noListingsInSection ??
                    (language === "fr"
                      ? "Aucune annonce trouvée pour cette section pour le moment."
                      : "No listings found for this section yet.")}
                </div>
              ) : null}

              {filteredItems.length > 7 ? (
                <div className="flex flex-col gap-4 border-t border-zinc-200 px-6 py-4 text-sm text-zinc-500 md:flex-row md:items-center md:justify-between">
                  <p>
                    {language === "fr"
                      ? `0 sur ${filteredItems.length} ligne(s) sélectionnée(s).`
                      : `0 of ${filteredItems.length} row(s) selected.`}
                  </p>
                  <div className="flex flex-col gap-4 md:flex-row md:items-center">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-zinc-700">
                        {t.rowsPerPage ?? (language === "fr" ? "Lignes par page" : "Rows per page")}
                      </span>
                      <div className="flex items-center gap-2">
                        {rowsPerPageOptions.map((option) => (
                          <Button
                            key={option}
                            asChild
                            variant={rowsPerPage === option ? "outline" : "ghost"}
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
                        {language === "fr"
                          ? `Page ${currentPage} sur ${totalPages}`
                          : `Page ${currentPage} of ${totalPages}`}
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