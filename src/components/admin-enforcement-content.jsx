"use client";

import Link from "next/link";
import {
  ArrowRightIcon,
  UserRoundSearchIcon,
} from "lucide-react";

import { ClientFormattedDateTime } from "@/components/client-formatted-date-time";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AdminQueueFilters } from "@/components/admin-queue-filters";
import { AdminQueueHeader } from "@/components/admin-queue-header";
import { adminReviewHref } from "@/lib/admin-queue-navigation.mjs";
import { useLanguage } from "@/context/LanguageContext";
import { getAdminEnforcementHref } from "@/lib/admin-enforcement.mjs";
import { getTranslatedReportReason } from "@/lib/moderation";
import { cn } from "@/lib/utils";

const SEVERITY_CLASS = {
  low: "border-sky-300 bg-sky-50 text-sky-800 dark:border-sky-500/30 dark:bg-sky-500/10 dark:text-sky-200",
  medium: "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200",
  high: "border-orange-300 bg-orange-50 text-orange-900 dark:border-orange-500/30 dark:bg-orange-500/10 dark:text-orange-200",
  critical: "border-red-300 bg-red-50 text-red-900 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-200",
};

function fallback(t, key, value) {
  return t?.[key] ?? value;
}

function sanctionTypeLabel(type, t) {
  if (type === "ban") return t.standingBan;
  if (type === "strike") return t.standingStrike;
  return t.standingWarning;
}

function lifecycleLabel(record, t) {
  if (record.reviewStatus === "pending") return t.standingReviewPending;
  if (record.reviewStatus === "overturned") return t.standingReviewOverturned;
  if (record.reviewStatus === "modified") return t.standingReviewModified;
  if (record.revokedAt) return t.standingLifecycleRevoked;
  if (record.isActive) return t.standingLifecycleActive;
  return t.standingLifecycleExpired;
}

export function AdminEnforcementContent({
  records,
  filters,
  totalCount,
  pageCount,
  setupError = false,
}) {
  const { t, language } = useLanguage();
  const title = fallback(t, "adminEnforcementTitle", "Enforcement");

  return (
    <div className="mx-auto flex w-full max-w-[1280px] min-w-0 flex-col gap-4 sm:gap-5">
      <AdminQueueHeader title={title} description={t.adminEnforcementDescription} count={setupError ? undefined : totalCount} t={t} />
      <AdminQueueFilters action="/admin/enforcement" search={filters.query} searchLabel={t.adminEnforcementSearchPlaceholder} quickFilter="status" fields={[
        { name: "status", label: t.adminEnforcementStatusFilter, value: filters.status, options: [
          { value: "all", label: t.all }, { value: "active", label: t.adminEnforcementActive }, { value: "review", label: t.adminEnforcementPendingReview }, { value: "history", label: t.adminEnforcementHistory },
        ] },
        { name: "type", label: t.adminEnforcementTypeFilter, value: filters.type, options: [
          { value: "all", label: t.adminEnforcementAllTypes }, { value: "warning", label: t.standingWarning }, { value: "strike", label: t.standingStrike }, { value: "ban", label: t.standingBan },
        ] },
        { name: "severity", label: t.adminEnforcementSeverityFilter, value: filters.severity, options: [
          { value: "all", label: t.adminEnforcementAllSeverities }, { value: "low", label: t.standingSeverityLow }, { value: "medium", label: t.standingSeverityMedium }, { value: "high", label: t.standingSeverityHigh }, { value: "critical", label: t.standingSeverityCritical },
        ] },
      ]} />

      <section aria-labelledby="enforcement-results-title" className="min-w-0 rounded-2xl border border-border bg-card shadow-sm sm:rounded-3xl">
        <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3 sm:px-5">
          <h2 id="enforcement-results-title" className="text-sm font-semibold text-foreground">
            {fallback(t, "adminEnforcementResults", "Results")}
          </h2>
          <Badge variant="secondary" className="rounded-full">{totalCount}</Badge>
        </div>

        {setupError ? (
          <p className="px-4 py-10 text-center text-sm text-muted-foreground">
            {t.adminUsersSetupDescription}
          </p>
        ) : records.length === 0 ? (
          <div className="grid place-items-center px-4 py-12 text-center">
            <UserRoundSearchIcon aria-hidden="true" className="size-8 text-muted-foreground" />
            <p className="mt-3 text-sm text-muted-foreground">
              {fallback(t, "adminEnforcementEmpty", "No enforcement records match these filters.")}
            </p>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {records.map((record) => (
              <article id={`record-${record.id}`} key={record.id} className="grid min-w-0 gap-3 px-4 py-4 sm:px-5 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline" className="rounded-full">{sanctionTypeLabel(record.sanctionType, t)}</Badge>
                    <Badge variant="outline" className={cn("rounded-full", SEVERITY_CLASS[record.severity])}>{({ low: t.standingSeverityLow, medium: t.standingSeverityMedium, high: t.standingSeverityHigh, critical: t.standingSeverityCritical })[record.severity]}</Badge>
                    <span className="text-xs font-medium text-muted-foreground">{lifecycleLabel(record, t)}</span>
                  </div>
                  <h3 className="mt-2 break-words text-base font-semibold text-foreground">
                    {record.subjectName ?? t.student}
                  </h3>
                  <p className="mt-0.5 break-words text-xs text-muted-foreground">
                    {record.subjectSchool ?? record.subjectUserId}
                  </p>
                  <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-5 text-foreground">
                    {record.userMessage}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                    <span>{getTranslatedReportReason(record.reasonCode, t)}</span>
                    <span>{fallback(t, "adminEnforcementIssuedBy", "Issued by")}: {record.issuedByName ?? record.issuedByRole}</span>
                    <ClientFormattedDateTime value={record.createdAt} language={language} />
                  </div>
                </div>
                <Button asChild variant="outline" size="sm" className="min-h-11 w-full rounded-xl sm:w-auto">
                  <Link href={adminReviewHref(`/admin/users/${record.subjectUserId}`, getAdminEnforcementHref(filters), record.id)}>
                    {fallback(t, "adminEnforcementOpenUser", "Open user")}
                    <ArrowRightIcon aria-hidden="true" className="size-4" />
                  </Link>
                </Button>
              </article>
            ))}
          </div>
        )}
      </section>

      {pageCount > 1 ? (
        <nav aria-label={`${title} pagination`} className="flex items-center justify-between gap-3">
          <Button asChild={filters.page > 1} disabled={filters.page <= 1} variant="outline" className="rounded-xl">
            {filters.page > 1 ? <Link href={getAdminEnforcementHref(filters, filters.page - 1)}>{t.previousPage}</Link> : <span>{t.previousPage}</span>}
          </Button>
          <span className="text-xs text-muted-foreground">{filters.page} / {pageCount}</span>
          <Button asChild={filters.page < pageCount} disabled={filters.page >= pageCount} variant="outline" className="rounded-xl">
            {filters.page < pageCount ? <Link href={getAdminEnforcementHref(filters, filters.page + 1)}>{t.nextPage}</Link> : <span>{t.nextPage}</span>}
          </Button>
        </nav>
      ) : null}
    </div>
  );
}
