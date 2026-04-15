"use client";

import * as React from "react";
import Link from "next/link";
import { ClipboardCheck, Flag, MessageSquareWarning, Search, Store, UserRound } from "lucide-react";

import { ClientFormattedDateTime } from "@/components/client-formatted-date-time";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useLanguage } from "@/context/LanguageContext";
import {
  REPORT_STATUS_VALUES,
  REPORT_SUBJECT_TYPES,
  getModerationReportGroupKey,
  getTranslatedReportReason,
  getTranslatedReportStatus,
  getTranslatedReportSubjectType,
} from "@/lib/moderation";
import {
  getTranslatedListingApprovalStatus,
  isListingResubmittedAfterEdit,
} from "@/lib/listing-approval";
import { cn } from "@/lib/utils";

function SummaryCard({ icon: Icon, title, value, description }) {
  return (
    <Card className="rounded-3xl bg-gradient-to-t from-primary/5 to-card py-0 shadow-xs ring-border dark:bg-card">
      <CardContent className="flex items-center gap-4 px-6 py-5">
        <div className="flex size-12 items-center justify-center rounded-2xl bg-muted text-foreground">
          <Icon className="size-5" />
        </div>
        <div>
          <p className="text-sm text-muted-foreground">{title}</p>
          <p className="text-2xl font-semibold text-foreground">{value}</p>
          <p className="text-sm text-muted-foreground">{description}</p>
        </div>
      </CardContent>
    </Card>
  );
}

function getReportSubjectPreview(report, t) {
  if (report.subjectType === REPORT_SUBJECT_TYPES.listing) {
    return report.listing?.title ?? t.unknown;
  }

  if (report.subjectType === REPORT_SUBJECT_TYPES.profile) {
    return report.profile?.name ?? report.reportedUser.name;
  }

  return report.message?.body ?? t.unknown;
}

function getReportSortTime(report) {
  return new Date(report.createdAt ?? 0).getTime();
}

function buildReportGroups(reports, t) {
  const groupsByKey = new Map();

  for (const report of reports) {
    const groupKey = getModerationReportGroupKey(report);
    const existingGroup = groupsByKey.get(groupKey);

    if (existingGroup) {
      existingGroup.reports.push(report);
      continue;
    }

    groupsByKey.set(groupKey, {
      key: groupKey,
      subjectType: report.subjectType,
      reportedUser: report.reportedUser,
      reports: [report],
    });
  }

  return [...groupsByKey.values()]
    .map((group) => {
      const sortedReports = [...group.reports].sort(
        (firstReport, secondReport) => getReportSortTime(secondReport) - getReportSortTime(firstReport),
      );
      const openReports = sortedReports.filter(
        (report) => report.status === REPORT_STATUS_VALUES.open,
      );
      const latestReport = sortedReports[0] ?? null;
      const primaryReport = openReports[0] ?? latestReport;
      const latestReviewedReport = sortedReports.find((report) => report.reviewedAt) ?? null;
      const reasonLabels = [...new Set(
        sortedReports.map((report) => getTranslatedReportReason(report.reason, t, report.subjectType)),
      )];
      const reporterNames = [...new Set(sortedReports.map((report) => report.reporter.name).filter(Boolean))];

      return {
        key: group.key,
        subjectType: group.subjectType,
        subjectPreview: getReportSubjectPreview(primaryReport, t),
        reportedUser: primaryReport.reportedUser,
        latestReportId: primaryReport.id,
        latestReportedAt: latestReport?.createdAt ?? null,
        latestReporterName: latestReport?.reporter.name ?? t.unknown,
        latestStatus: openReports.length > 0 ? REPORT_STATUS_VALUES.open : latestReport?.status,
        latestReviewedAt: latestReviewedReport?.reviewedAt ?? null,
        latestReviewedByName: latestReviewedReport?.reviewedBy?.name ?? null,
        totalCount: sortedReports.length,
        openCount: openReports.length,
        reasonLabels,
        reporterNames,
        reports: sortedReports,
      };
    })
    .sort((firstGroup, secondGroup) => {
      return new Date(secondGroup.latestReportedAt ?? 0).getTime() - new Date(firstGroup.latestReportedAt ?? 0).getTime();
    });
}

function getReportGroupSearchText(group, t) {
  return [
    group.subjectPreview,
    group.reportedUser?.name,
    ...group.reporterNames,
    ...group.reasonLabels,
    getTranslatedReportSubjectType(group.subjectType, t),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

const DASHBOARD_SECTION_PAGE_SIZE = 20;

function getListingSearchText(listing, t) {
  return [
    listing.title,
    listing.seller?.name,
    listing.reviewedBy?.name,
    listing.location,
    listing.moderationFeedback,
    getTranslatedListingApprovalStatus(listing.status, t, listing),
    isListingResubmittedAfterEdit(listing) ? t.adminListingResubmittedBadge : null,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function filterItemsBySearch(items, searchQuery, getSearchText) {
  const normalizedQuery = searchQuery.trim().toLowerCase();

  if (!normalizedQuery) {
    return items;
  }

  return items.filter((item) => getSearchText(item).includes(normalizedQuery));
}

function getTotalPages(itemCount, pageSize = DASHBOARD_SECTION_PAGE_SIZE) {
  return Math.max(1, Math.ceil(itemCount / pageSize));
}

function paginateItems(items, currentPage, pageSize = DASHBOARD_SECTION_PAGE_SIZE) {
  const startIndex = (currentPage - 1) * pageSize;
  return items.slice(startIndex, startIndex + pageSize);
}

function SearchField({ value, onChange, placeholder }) {
  return (
    <div className="relative w-full lg:max-w-sm">
      <Search className="pointer-events-none absolute top-0 bottom-0 left-3 my-auto size-4 text-muted-foreground" />
      <Input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="h-10 rounded-full bg-background pl-9"
        aria-label={placeholder}
      />
    </div>
  );
}

function PaginationControls({ currentPage, totalPages, onPrevious, onNext, t }) {
  if (totalPages <= 1) {
    return null;
  }

  return (
    <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
      <p className="text-sm text-muted-foreground">
        {t.pageLabel} {currentPage} / {totalPages}
      </p>
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="rounded-xl"
          onClick={onPrevious}
          disabled={currentPage <= 1}
        >
          {t.previousPage}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="rounded-xl"
          onClick={onNext}
          disabled={currentPage >= totalPages}
        >
          {t.nextPage}
        </Button>
      </div>
    </div>
  );
}

function ReportQueueTable({ reportGroups, language, t }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{t.type}</TableHead>
          <TableHead>{t.adminSubject}</TableHead>
          <TableHead>{t.adminReasons}</TableHead>
          <TableHead>{t.adminGroupedReports}</TableHead>
          <TableHead>{t.adminReportedUser}</TableHead>
          <TableHead>{t.adminLatestReport}</TableHead>
          <TableHead className="text-right">{t.action}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {reportGroups.length > 0 ? (
          reportGroups.map((group) => {
            const displayedReasons = group.reasonLabels.slice(0, 2);
            const remainingReasonCount = Math.max(0, group.reasonLabels.length - displayedReasons.length);

            return (
              <TableRow key={group.key}>
                <TableCell>
                  <Badge variant="outline" className="rounded-full border-border bg-background px-2.5 py-0.5 text-foreground">
                    {getTranslatedReportSubjectType(group.subjectType, t)}
                  </Badge>
                </TableCell>
                <TableCell className="max-w-[280px]">
                  <Link
                    href={`/admin/reports/${group.latestReportId}`}
                    className="block font-medium text-foreground hover:underline"
                    title={group.subjectPreview}
                  >
                    <span className="block truncate">{group.subjectPreview}</span>
                  </Link>
                  <p className="mt-1 truncate text-xs text-muted-foreground">
                    {t.adminLatestReporter}: {group.latestReporterName}
                  </p>
                </TableCell>
                <TableCell>
                  <div className="flex flex-wrap gap-1.5">
                    {displayedReasons.map((reasonLabel) => (
                      <Badge
                        key={reasonLabel}
                        variant="outline"
                        className="rounded-full border-border bg-background px-2.5 py-0.5 text-foreground"
                      >
                        {reasonLabel}
                      </Badge>
                    ))}
                    {remainingReasonCount > 0 ? (
                      <Badge variant="outline" className="rounded-full border-border bg-background px-2.5 py-0.5 text-foreground">
                        +{remainingReasonCount}
                      </Badge>
                    ) : null}
                  </div>
                </TableCell>
                <TableCell>
                  <div className="flex flex-wrap gap-1.5">
                    <Badge variant="outline" className="rounded-full border-border bg-background px-2.5 py-0.5 text-foreground">
                      {group.totalCount} {t.adminReportsCountLabel}
                    </Badge>
                    {group.openCount > 0 ? (
                      <Badge className="rounded-full bg-primary/10 px-2.5 py-0.5 text-primary shadow-none dark:bg-primary/15">
                        {group.openCount} {t.adminOpenCountLabel}
                      </Badge>
                    ) : null}
                  </div>
                </TableCell>
                <TableCell>{group.reportedUser.name}</TableCell>
                <TableCell>
                  <div className="space-y-1">
                    <Badge variant="outline" className="rounded-full border-border bg-background px-2.5 py-0.5 text-foreground">
                      {getTranslatedReportStatus(group.latestStatus, t)}
                    </Badge>
                    <div>
                      <ClientFormattedDateTime
                        value={group.openCount > 0 ? group.latestReportedAt : group.latestReviewedAt ?? group.latestReportedAt}
                        language={language}
                        className="text-sm text-muted-foreground"
                      />
                    </div>
                    {group.openCount === 0 && group.latestReviewedByName ? (
                      <p className="text-xs text-muted-foreground">
                        {t.adminReviewedBy}: {group.latestReviewedByName}
                      </p>
                    ) : null}
                  </div>
                </TableCell>
                <TableCell className="text-right">
                  <Button asChild variant="outline" size="sm" className="rounded-xl">
                    <Link href={`/admin/reports/${group.latestReportId}`}>{t.review}</Link>
                  </Button>
                </TableCell>
              </TableRow>
            );
          })
        ) : (
          <TableRow>
            <TableCell colSpan={7} className="py-10 text-center text-sm text-muted-foreground">
              {t.noReports}
            </TableCell>
          </TableRow>
        )}
      </TableBody>
    </Table>
  );
}

function ListingApprovalTable({ listings, language, t, dateLabel, emptyText }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{t.adminSubject}</TableHead>
          <TableHead>{t.seller}</TableHead>
          <TableHead>{t.status}</TableHead>
          <TableHead>{dateLabel}</TableHead>
          <TableHead>{t.adminFeedback}</TableHead>
          <TableHead className="text-right">{t.action}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {listings.length > 0 ? (
          listings.map((listing) => (
            <TableRow key={listing.id}>
              <TableCell className="max-w-[300px]">
                <Link
                  href={`/admin/listings/${listing.id}`}
                  className="block truncate font-medium text-foreground hover:underline"
                  title={listing.title}
                >
                  {listing.title}
                </Link>
                {isListingResubmittedAfterEdit(listing) ? (
                  <p className="mt-1 text-xs text-muted-foreground">
                    {t.adminListingResubmittedBadge}
                  </p>
                ) : null}
              </TableCell>
              <TableCell>{listing.seller.name}</TableCell>
              <TableCell>
                <Badge variant="outline" className="rounded-full border-border bg-background px-2.5 py-0.5 text-foreground">
                  {getTranslatedListingApprovalStatus(listing.status, t, listing)}
                </Badge>
              </TableCell>
              <TableCell>
                <ClientFormattedDateTime
                  value={listing.queueAt}
                  language={language}
                  className="text-sm text-muted-foreground"
                />
              </TableCell>
              <TableCell className="max-w-[280px]">
                <span className="line-clamp-2 text-sm text-muted-foreground">
                  {listing.moderationFeedback || "—"}
                </span>
              </TableCell>
              <TableCell className="text-right">
                <Button asChild variant="outline" size="sm" className="rounded-xl">
                  <Link href={`/admin/listings/${listing.id}`}>{t.review}</Link>
                </Button>
              </TableCell>
            </TableRow>
          ))
        ) : (
          <TableRow>
            <TableCell colSpan={6} className="py-10 text-center text-sm text-muted-foreground">
              {emptyText}
            </TableCell>
          </TableRow>
        )}
      </TableBody>
    </Table>
  );
}

export function AdminModerationDashboard({
  initialReports,
  reportsAvailable,
  pendingListingApprovals = [],
  recentListingDecisions = [],
  listingApprovalAvailable = false,
}) {
  const { t, language } = useLanguage();
  const [typeFilter, setTypeFilter] = React.useState("all");
  const [reportSearchQuery, setReportSearchQuery] = React.useState("");
  const [reviewSearchQuery, setReviewSearchQuery] = React.useState("");
  const [listingApprovalSearchQuery, setListingApprovalSearchQuery] = React.useState("");
  const [recentDecisionSearchQuery, setRecentDecisionSearchQuery] = React.useState("");
  const [openReportsPage, setOpenReportsPage] = React.useState(1);
  const [reviewedReportsPage, setReviewedReportsPage] = React.useState(1);
  const [listingApprovalsPage, setListingApprovalsPage] = React.useState(1);
  const [recentDecisionsPage, setRecentDecisionsPage] = React.useState(1);

  const reports = React.useMemo(() => initialReports ?? [], [initialReports]);

  const reportGroups = React.useMemo(() => buildReportGroups(reports, t), [reports, t]);

  const openReportGroups = React.useMemo(
    () => reportGroups.filter((group) => group.openCount > 0),
    [reportGroups],
  );

  const reviewedReportGroups = React.useMemo(
    () => reportGroups.filter((group) => group.openCount === 0),
    [reportGroups],
  );

  const filteredOpenReportGroups = React.useMemo(() => {
    const normalizedQuery = reportSearchQuery.trim().toLowerCase();

    return openReportGroups.filter((group) => {
      const matchesType = typeFilter === "all" || group.subjectType === typeFilter;
      const matchesQuery =
        normalizedQuery.length === 0 || getReportGroupSearchText(group, t).includes(normalizedQuery);

      return matchesType && matchesQuery;
    });
  }, [openReportGroups, reportSearchQuery, t, typeFilter]);

  const filteredReviewedReportGroups = React.useMemo(
    () => filterItemsBySearch(reviewedReportGroups, reviewSearchQuery, (group) => getReportGroupSearchText(group, t)),
    [reviewedReportGroups, reviewSearchQuery, t],
  );

  const filteredPendingListingApprovals = React.useMemo(
    () => filterItemsBySearch(pendingListingApprovals, listingApprovalSearchQuery, (listing) => getListingSearchText(listing, t)),
    [pendingListingApprovals, listingApprovalSearchQuery, t],
  );

  const filteredRecentListingDecisions = React.useMemo(
    () => filterItemsBySearch(recentListingDecisions, recentDecisionSearchQuery, (listing) => getListingSearchText(listing, t)),
    [recentListingDecisions, recentDecisionSearchQuery, t],
  );

  const openReportsTotalPages = getTotalPages(filteredOpenReportGroups.length);
  const reviewedReportsTotalPages = getTotalPages(filteredReviewedReportGroups.length);
  const listingApprovalsTotalPages = getTotalPages(filteredPendingListingApprovals.length);
  const recentDecisionsTotalPages = getTotalPages(filteredRecentListingDecisions.length);

  const paginatedOpenReportGroups = React.useMemo(
    () => paginateItems(filteredOpenReportGroups, openReportsPage),
    [filteredOpenReportGroups, openReportsPage],
  );

  const paginatedReviewedReportGroups = React.useMemo(
    () => paginateItems(filteredReviewedReportGroups, reviewedReportsPage),
    [filteredReviewedReportGroups, reviewedReportsPage],
  );

  const paginatedPendingListingApprovals = React.useMemo(
    () => paginateItems(filteredPendingListingApprovals, listingApprovalsPage),
    [filteredPendingListingApprovals, listingApprovalsPage],
  );

  const paginatedRecentListingDecisions = React.useMemo(
    () => paginateItems(filteredRecentListingDecisions, recentDecisionsPage),
    [filteredRecentListingDecisions, recentDecisionsPage],
  );

  React.useEffect(() => {
    setOpenReportsPage(1);
  }, [reportSearchQuery, typeFilter]);

  React.useEffect(() => {
    setReviewedReportsPage(1);
  }, [reviewSearchQuery]);

  React.useEffect(() => {
    setListingApprovalsPage(1);
  }, [listingApprovalSearchQuery]);

  React.useEffect(() => {
    setRecentDecisionsPage(1);
  }, [recentDecisionSearchQuery]);

  React.useEffect(() => {
    if (openReportsPage > openReportsTotalPages) {
      setOpenReportsPage(openReportsTotalPages);
    }
  }, [openReportsPage, openReportsTotalPages]);

  React.useEffect(() => {
    if (reviewedReportsPage > reviewedReportsTotalPages) {
      setReviewedReportsPage(reviewedReportsTotalPages);
    }
  }, [reviewedReportsPage, reviewedReportsTotalPages]);

  React.useEffect(() => {
    if (listingApprovalsPage > listingApprovalsTotalPages) {
      setListingApprovalsPage(listingApprovalsTotalPages);
    }
  }, [listingApprovalsPage, listingApprovalsTotalPages]);

  React.useEffect(() => {
    if (recentDecisionsPage > recentDecisionsTotalPages) {
      setRecentDecisionsPage(recentDecisionsTotalPages);
    }
  }, [recentDecisionsPage, recentDecisionsTotalPages]);

  const totalOpenReports = reports.filter(
    (report) => report.status === REPORT_STATUS_VALUES.open,
  );

  const listingReportCount = totalOpenReports.filter(
    (report) => report.subjectType === REPORT_SUBJECT_TYPES.listing,
  ).length;
  const messageReportCount = totalOpenReports.filter(
    (report) => report.subjectType === REPORT_SUBJECT_TYPES.message,
  ).length;
  const profileReportCount = totalOpenReports.filter(
    (report) => report.subjectType === REPORT_SUBJECT_TYPES.profile,
  ).length;
  const pendingListingApprovalCount = pendingListingApprovals.length;
  const hasActiveFilters = typeFilter !== "all" || reportSearchQuery.trim().length > 0;
  const filterOptions = [
    { value: "all", label: t.all },
    { value: REPORT_SUBJECT_TYPES.listing, label: t.adminListings },
    { value: REPORT_SUBJECT_TYPES.message, label: t.messages },
    { value: REPORT_SUBJECT_TYPES.profile, label: t.profile },
  ];

  function clearFilters() {
    setTypeFilter("all");
    setReportSearchQuery("");
  }

  if (!reportsAvailable) {
    return (
      <Card className="rounded-3xl bg-card py-0 shadow-sm ring-border">
        <CardHeader className="border-b border-border px-6 py-6">
          <CardTitle className="text-2xl text-foreground">{t.adminSetupTitle}</CardTitle>
          <CardDescription>{t.adminSetupDescription}</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-4 @xl/main:grid-cols-2 @5xl/main:grid-cols-5">
        <SummaryCard
          icon={Flag}
          title={t.pendingReports}
          value={totalOpenReports.length}
          description={t.adminReviewQueueDescription}
        />
        <SummaryCard
          icon={Store}
          title={t.adminListings}
          value={listingReportCount}
          description={t.adminListingReportsDescription}
        />
        <SummaryCard
          icon={MessageSquareWarning}
          title={t.messages}
          value={messageReportCount}
          description={t.adminMessageReportsDescription}
        />
        <SummaryCard
          icon={UserRound}
          title={t.profile}
          value={profileReportCount}
          description={t.adminProfileReportsDescription}
        />
        <SummaryCard
          icon={ClipboardCheck}
          title={t.adminPendingListingApprovals}
          value={pendingListingApprovalCount}
          description={t.adminListingApprovalQueueDescription}
        />
      </div>

      <Card className="rounded-3xl bg-card py-0 shadow-sm ring-border">
        <CardHeader className="border-b border-border px-6 py-6">
          <CardTitle className="text-2xl text-foreground">{t.adminReports}</CardTitle>
          <CardDescription>{t.adminQueueDescription}</CardDescription>

          <div className="mt-4 flex flex-col gap-3">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div className="flex flex-wrap gap-2">
                {filterOptions.map((option) => {
                  const isActive = typeFilter === option.value;

                  return (
                    <Button
                      key={option.value}
                      type="button"
                      variant={isActive ? "default" : "outline"}
                      size="sm"
                      className={cn("rounded-full px-3", !isActive && "bg-background")}
                      onClick={() => setTypeFilter(option.value)}
                    >
                      {option.label}
                    </Button>
                  );
                })}

                {hasActiveFilters ? (
                  <Button type="button" variant="ghost" size="sm" className="rounded-full px-3" onClick={clearFilters}>
                    {t.clearFilters}
                  </Button>
                ) : null}
              </div>

              <SearchField
                value={reportSearchQuery}
                onChange={setReportSearchQuery}
                placeholder={t.adminSearchReportsPlaceholder}
              />
            </div>
          </div>
        </CardHeader>
        <CardContent className="px-6 py-6">
          {filteredOpenReportGroups.length > 0 ? (
            <>
              <ReportQueueTable reportGroups={paginatedOpenReportGroups} language={language} t={t} />
              <PaginationControls
                currentPage={openReportsPage}
                totalPages={openReportsTotalPages}
                onPrevious={() => setOpenReportsPage((currentPage) => Math.max(1, currentPage - 1))}
                onNext={() => setOpenReportsPage((currentPage) => Math.min(openReportsTotalPages, currentPage + 1))}
                t={t}
              />
            </>
          ) : (
            <div className="rounded-3xl border border-dashed border-border bg-muted/30 px-5 py-10 text-center text-sm text-muted-foreground">
              {hasActiveFilters ? t.adminNoOpenReportsMatchFilters : t.noPendingReports}
            </div>
          )}
        </CardContent>
      </Card>

      {listingApprovalAvailable ? (
        <>
          <Card className="rounded-3xl bg-card py-0 shadow-sm ring-border">
            <CardHeader className="border-b border-border px-6 py-6">
              <CardTitle className="text-2xl text-foreground">{t.adminListingApprovals}</CardTitle>
              <CardDescription>{t.adminListingApprovalQueueDescription}</CardDescription>
              <div className="mt-4">
                <SearchField
                  value={listingApprovalSearchQuery}
                  onChange={setListingApprovalSearchQuery}
                  placeholder={t.adminSearchListingApprovalsPlaceholder}
                />
              </div>
            </CardHeader>
            <CardContent className="px-6 py-6">
              {filteredPendingListingApprovals.length > 0 ? (
                <>
                  <ListingApprovalTable
                    listings={paginatedPendingListingApprovals}
                    language={language}
                    t={t}
                    dateLabel={t.adminSubmittedForReviewAt}
                    emptyText={t.adminNoPendingListingApprovals}
                  />
                  <PaginationControls
                    currentPage={listingApprovalsPage}
                    totalPages={listingApprovalsTotalPages}
                    onPrevious={() => setListingApprovalsPage((currentPage) => Math.max(1, currentPage - 1))}
                    onNext={() => setListingApprovalsPage((currentPage) => Math.min(listingApprovalsTotalPages, currentPage + 1))}
                    t={t}
                  />
                </>
              ) : (
                <div className="rounded-3xl border border-dashed border-border bg-muted/30 px-5 py-10 text-center text-sm text-muted-foreground">
                  {listingApprovalSearchQuery.trim().length > 0
                    ? t.adminNoListingApprovalsMatchSearch
                    : t.adminNoPendingListingApprovals}
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="rounded-3xl bg-card py-0 shadow-sm ring-border">
            <CardHeader className="border-b border-border px-6 py-6">
              <CardTitle className="text-2xl text-foreground">{t.adminRecentListingDecisionsTitle}</CardTitle>
              <CardDescription>{t.adminRecentListingDecisionsDescription}</CardDescription>
              <div className="mt-4">
                <SearchField
                  value={recentDecisionSearchQuery}
                  onChange={setRecentDecisionSearchQuery}
                  placeholder={t.adminSearchRecentListingDecisionsPlaceholder}
                />
              </div>
            </CardHeader>
            <CardContent className="px-6 py-6">
              {filteredRecentListingDecisions.length > 0 ? (
                <>
                  <ListingApprovalTable
                    listings={paginatedRecentListingDecisions}
                    language={language}
                    t={t}
                    dateLabel={t.reviewedAt}
                    emptyText={t.adminNoRecentListingDecisions}
                  />
                  <PaginationControls
                    currentPage={recentDecisionsPage}
                    totalPages={recentDecisionsTotalPages}
                    onPrevious={() => setRecentDecisionsPage((currentPage) => Math.max(1, currentPage - 1))}
                    onNext={() => setRecentDecisionsPage((currentPage) => Math.min(recentDecisionsTotalPages, currentPage + 1))}
                    t={t}
                  />
                </>
              ) : (
                <div className="rounded-3xl border border-dashed border-border bg-muted/30 px-5 py-10 text-center text-sm text-muted-foreground">
                  {recentDecisionSearchQuery.trim().length > 0
                    ? t.adminNoRecentListingDecisionsMatchSearch
                    : t.adminNoRecentListingDecisions}
                </div>
              )}
            </CardContent>
          </Card>
        </>
      ) : (
        <Card className="rounded-3xl bg-card py-0 shadow-sm ring-border">
          <CardHeader className="border-b border-border px-6 py-6">
            <CardTitle className="text-2xl text-foreground">{t.adminListingApprovals}</CardTitle>
            <CardDescription>{t.adminListingApprovalSetupDescription}</CardDescription>
          </CardHeader>
        </Card>
      )}

      <Card className="rounded-3xl bg-card py-0 shadow-sm ring-border">
        <CardHeader className="border-b border-border px-6 py-6">
          <CardTitle className="text-2xl text-foreground">{t.adminRecentReviewsTitle}</CardTitle>
          <CardDescription>{t.adminRecentReviewsDescription}</CardDescription>
          <div className="mt-4">
            <SearchField
              value={reviewSearchQuery}
              onChange={setReviewSearchQuery}
              placeholder={t.adminSearchRecentReviewsPlaceholder}
            />
          </div>
        </CardHeader>
        <CardContent className="px-6 py-6">
          {filteredReviewedReportGroups.length > 0 ? (
            <>
              <ReportQueueTable
                reportGroups={paginatedReviewedReportGroups}
                language={language}
                t={t}
              />
              <PaginationControls
                currentPage={reviewedReportsPage}
                totalPages={reviewedReportsTotalPages}
                onPrevious={() => setReviewedReportsPage((currentPage) => Math.max(1, currentPage - 1))}
                onNext={() => setReviewedReportsPage((currentPage) => Math.min(reviewedReportsTotalPages, currentPage + 1))}
                t={t}
              />
            </>
          ) : (
            <div className="rounded-3xl border border-dashed border-border bg-muted/30 px-5 py-10 text-center text-sm text-muted-foreground">
              {reviewSearchQuery.trim().length > 0 ? t.adminNoRecentReviewsMatchSearch : t.noReports}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
