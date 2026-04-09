"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Flag, MessageSquareWarning, Store } from "lucide-react";
import { toast } from "sonner";

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
import { Separator } from "@/components/ui/separator";
import { useLanguage } from "@/context/LanguageContext";
import {
  REPORT_STATUS_VALUES,
  REPORT_SUBJECT_TYPES,
  getTranslatedReportReason,
  getTranslatedReportStatus,
  getTranslatedReportSubjectType,
} from "@/lib/moderation";
import { createClient } from "@/utils/supabase/client";

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

function ReportMetadataRow({ label, children }) {
  return (
    <div className="space-y-1">
      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
        {label}
      </p>
      <div className="text-sm text-foreground">{children}</div>
    </div>
  );
}

function ReportCard({
  report,
  language,
  t,
  isProcessing,
  onResolve,
  onDismiss,
  onRemoveListing,
}) {
  const isOpen = report.status === REPORT_STATUS_VALUES.open;
  const canRemoveListing =
    report.subjectType === REPORT_SUBJECT_TYPES.listing && report.listing?.status === "active";
  const canViewContext =
    report.subjectType === REPORT_SUBJECT_TYPES.message && report.message?.id && report.conversationId;

  return (
    <div className="rounded-3xl border border-border bg-card p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline" className="rounded-full border-border bg-background px-2.5 py-0.5 text-foreground">
              {getTranslatedReportSubjectType(report.subjectType, t)}
            </Badge>
            <Badge variant="outline" className="rounded-full border-border bg-background px-2.5 py-0.5 text-foreground">
              {getTranslatedReportReason(report.reason, t)}
            </Badge>
            <Badge variant="outline" className="rounded-full border-border bg-background px-2.5 py-0.5 text-foreground">
              {getTranslatedReportStatus(report.status, t)}
            </Badge>
          </div>
          {report.subjectType === REPORT_SUBJECT_TYPES.listing && report.listing ? (
            <div>
              <Link href={`/listings/${report.listing.slug}`} className="text-base font-semibold text-foreground hover:underline">
                {report.listing.title}
              </Link>
            </div>
          ) : report.message ? (
            <div className="max-w-2xl rounded-2xl bg-muted/50 px-4 py-3 text-sm text-foreground">
              {report.message.body}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">{t.unknown}</p>
          )}
        </div>

        <div className="shrink-0 text-right text-xs text-muted-foreground">
          <p>{t.reportedAt}</p>
          <ClientFormattedDateTime value={report.createdAt} language={language} />
        </div>
      </div>

      <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <ReportMetadataRow label={t.reporter}>{report.reporter.name}</ReportMetadataRow>
        <ReportMetadataRow label={t.adminReportedUser}>{report.reportedUser.name}</ReportMetadataRow>
        <ReportMetadataRow label={t.adminReason}>{getTranslatedReportReason(report.reason, t)}</ReportMetadataRow>
        <ReportMetadataRow label={t.status}>{getTranslatedReportStatus(report.status, t)}</ReportMetadataRow>
      </div>

      {report.details ? (
        <div className="mt-4 rounded-2xl border border-border bg-background px-4 py-3">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
            {t.adminDetails}
          </p>
          <p className="mt-2 whitespace-pre-wrap text-sm text-foreground">{report.details}</p>
        </div>
      ) : null}

      {!isOpen && report.reviewedAt ? (
        <div className="mt-4 text-xs text-muted-foreground">
          {t.reviewedAt} <ClientFormattedDateTime value={report.reviewedAt} language={language} />
        </div>
      ) : null}

      {isOpen ? (
        <div className="mt-5 flex flex-wrap justify-end gap-2">
          {canViewContext ? (
            <Button asChild variant="outline" className="rounded-xl">
              <Link href={`/admin/reports/${report.id}`}>{t.viewContext}</Link>
            </Button>
          ) : null}
          {canRemoveListing ? (
            <Button
              type="button"
              variant="outline"
              className="rounded-xl"
              onClick={() => onRemoveListing(report)}
              disabled={isProcessing}
            >
              {t.removeListing}
            </Button>
          ) : null}
          <Button
            type="button"
            variant="outline"
            className="rounded-xl"
            onClick={() => onDismiss(report)}
            disabled={isProcessing}
          >
            {t.dismiss}
          </Button>
          <Button
            type="button"
            className="rounded-xl"
            onClick={() => onResolve(report)}
            disabled={isProcessing}
          >
            {t.resolve}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

export function AdminModerationDashboard({ initialReports, currentUserId, reportsAvailable }) {
  const router = useRouter();
  const supabase = React.useMemo(() => createClient(), []);
  const { t, language } = useLanguage();
  const [reports, setReports] = React.useState(initialReports ?? []);
  const [processingReportId, setProcessingReportId] = React.useState(null);

  React.useEffect(() => {
    setReports(initialReports ?? []);
  }, [initialReports]);

  const openReports = React.useMemo(
    () => reports.filter((report) => report.status === REPORT_STATUS_VALUES.open),
    [reports],
  );
  const reviewedReports = React.useMemo(
    () => reports.filter((report) => report.status !== REPORT_STATUS_VALUES.open),
    [reports],
  );

  const listingReportCount = reports.filter(
    (report) => report.subjectType === REPORT_SUBJECT_TYPES.listing,
  ).length;
  const messageReportCount = reports.filter(
    (report) => report.subjectType === REPORT_SUBJECT_TYPES.message,
  ).length;

  function updateReportInState(reportId, changes, listingChanges = null) {
    setReports((currentReports) =>
      currentReports.map((report) => {
        if (report.id !== reportId) {
          return report;
        }

        return {
          ...report,
          ...changes,
          listing:
            listingChanges && report.listing
              ? {
                  ...report.listing,
                  ...listingChanges,
                }
              : report.listing,
        };
      }),
    );
  }

  async function handleUpdateStatus(report, nextStatus) {
    if (!report?.id || !currentUserId || processingReportId) {
      return;
    }

    setProcessingReportId(report.id);

    const reviewedAt = new Date().toISOString();
    const { error } = await supabase
      .from("reports")
      .update({
        status: nextStatus,
        reviewed_by: currentUserId,
        reviewed_at: reviewedAt,
      })
      .eq("id", report.id);

    setProcessingReportId(null);

    if (error) {
      console.error("Failed to update report status:", error.message);
      toast.error(t.adminReportActionError);
      return;
    }

    updateReportInState(report.id, { status: nextStatus, reviewedAt });
    toast.success(
      nextStatus === REPORT_STATUS_VALUES.dismissed ? t.reportDismissed : t.reportResolved,
    );
    router.refresh();
  }

  async function handleRemoveListing(report) {
    if (!report?.listing?.id || !currentUserId || processingReportId) {
      return;
    }

    setProcessingReportId(report.id);

    const { error: listingError } = await supabase
      .from("listings")
      .update({ status: "inactive" })
      .eq("id", report.listing.id);

    if (listingError) {
      setProcessingReportId(null);
      console.error("Failed to remove listing from moderation dashboard:", listingError.message);
      toast.error(t.adminReportActionError);
      return;
    }

    const reviewedAt = new Date().toISOString();
    const { error: reportError } = await supabase
      .from("reports")
      .update({
        status: REPORT_STATUS_VALUES.resolved,
        reviewed_by: currentUserId,
        reviewed_at: reviewedAt,
      })
      .eq("id", report.id);

    setProcessingReportId(null);

    if (reportError) {
      console.error("Failed to resolve report after removing listing:", reportError.message);
      toast.error(t.adminReportActionError);
      return;
    }

    updateReportInState(
      report.id,
      { status: REPORT_STATUS_VALUES.resolved, reviewedAt },
      { status: "inactive" },
    );
    toast.success(t.adminListingRemovedAndResolved);
    router.refresh();
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
      <div className="grid grid-cols-1 gap-4 @xl/main:grid-cols-2 @5xl/main:grid-cols-3">
        <SummaryCard
          icon={Flag}
          title={t.pendingReports}
          value={openReports.length}
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
      </div>

      <Card className="rounded-3xl bg-card py-0 shadow-sm ring-border">
        <CardHeader className="border-b border-border px-6 py-6">
          <CardTitle className="text-2xl text-foreground">{t.adminReports}</CardTitle>
          <CardDescription>{t.adminReportsDescription}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-5 px-6 py-6">
          {openReports.length > 0 ? (
            openReports.map((report) => (
              <ReportCard
                key={report.id}
                report={report}
                language={language}
                t={t}
                isProcessing={processingReportId === report.id}
                onResolve={(currentReport) =>
                  handleUpdateStatus(currentReport, REPORT_STATUS_VALUES.resolved)
                }
                onDismiss={(currentReport) =>
                  handleUpdateStatus(currentReport, REPORT_STATUS_VALUES.dismissed)
                }
                onRemoveListing={handleRemoveListing}
              />
            ))
          ) : (
            <div className="rounded-3xl border border-dashed border-border bg-muted/30 px-5 py-10 text-center text-sm text-muted-foreground">
              {t.noPendingReports}
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="rounded-3xl bg-card py-0 shadow-sm ring-border">
        <CardHeader className="border-b border-border px-6 py-6">
          <CardTitle className="text-2xl text-foreground">{t.adminRecentReviewsTitle}</CardTitle>
          <CardDescription>{t.adminRecentReviewsDescription}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 px-6 py-6">
          {reviewedReports.length > 0 ? (
            reviewedReports.slice(0, 10).map((report, index) => (
              <React.Fragment key={report.id}>
                {index > 0 ? <Separator /> : null}
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="font-medium text-foreground">
                      {getTranslatedReportSubjectType(report.subjectType, t)} · {getTranslatedReportReason(report.reason, t)}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {report.reporter.name} → {report.reportedUser.name}
                    </p>
                  </div>
                  <div className="flex items-center gap-3 text-sm text-muted-foreground">
                    <Badge variant="outline" className="rounded-full border-border bg-background px-2.5 py-0.5 text-foreground">
                      {getTranslatedReportStatus(report.status, t)}
                    </Badge>
                    {report.reviewedAt ? (
                      <ClientFormattedDateTime value={report.reviewedAt} language={language} />
                    ) : null}
                  </div>
                </div>
              </React.Fragment>
            ))
          ) : (
            <div className="rounded-3xl border border-dashed border-border bg-muted/30 px-5 py-10 text-center text-sm text-muted-foreground">
              {t.noReports}
            </div>
          )}
        </CardContent>
      </Card>

    </div>
  );
}
