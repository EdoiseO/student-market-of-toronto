"use client";

import Link from "next/link";
import { Flag, MessageSquareWarning, Store } from "lucide-react";

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
  getTranslatedReportReason,
  getTranslatedReportStatus,
  getTranslatedReportSubjectType,
} from "@/lib/moderation";

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

function ReportQueueTable({ reports, language, t }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{t.type}</TableHead>
          <TableHead>{t.adminSubject}</TableHead>
          <TableHead>{t.adminReason}</TableHead>
          <TableHead>{t.reporter}</TableHead>
          <TableHead>{t.adminReportedUser}</TableHead>
          <TableHead>{t.status}</TableHead>
          <TableHead>{t.reportedAt}</TableHead>
          <TableHead className="text-right">{t.action}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {reports.length > 0 ? (
          reports.map((report) => {
            const subjectPreview =
              report.subjectType === REPORT_SUBJECT_TYPES.listing
                ? report.listing?.title ?? t.unknown
                : report.message?.body ?? t.unknown;

            return (
              <TableRow key={report.id}>
                <TableCell>
                  <Badge variant="outline" className="rounded-full border-border bg-background px-2.5 py-0.5 text-foreground">
                    {getTranslatedReportSubjectType(report.subjectType, t)}
                  </Badge>
                </TableCell>
                <TableCell className="max-w-[280px]">
                  <Link
                    href={`/admin/reports/${report.id}`}
                    className="block truncate font-medium text-foreground hover:underline"
                    title={subjectPreview}
                  >
                    {subjectPreview}
                  </Link>
                </TableCell>
                <TableCell>{getTranslatedReportReason(report.reason, t)}</TableCell>
                <TableCell>{report.reporter.name}</TableCell>
                <TableCell>{report.reportedUser.name}</TableCell>
                <TableCell>
                  <Badge variant="outline" className="rounded-full border-border bg-background px-2.5 py-0.5 text-foreground">
                    {getTranslatedReportStatus(report.status, t)}
                  </Badge>
                </TableCell>
                <TableCell>
                  <ClientFormattedDateTime value={report.createdAt} language={language} className="text-sm text-muted-foreground" />
                </TableCell>
                <TableCell className="text-right">
                  <Button asChild variant="outline" size="sm" className="rounded-xl">
                    <Link href={`/admin/reports/${report.id}`}>{t.review}</Link>
                  </Button>
                </TableCell>
              </TableRow>
            );
          })
        ) : (
          <TableRow>
            <TableCell colSpan={8} className="py-10 text-center text-sm text-muted-foreground">
              {t.noReports}
            </TableCell>
          </TableRow>
        )}
      </TableBody>
    </Table>
  );
}

export function AdminModerationDashboard({ initialReports, reportsAvailable }) {
  const { t, language } = useLanguage();

  const reports = initialReports ?? [];
  const openReports = reports.filter((report) => report.status === REPORT_STATUS_VALUES.open);
  const reviewedReports = reports.filter((report) => report.status !== REPORT_STATUS_VALUES.open);

  const listingReportCount = reports.filter(
    (report) => report.subjectType === REPORT_SUBJECT_TYPES.listing,
  ).length;
  const messageReportCount = reports.filter(
    (report) => report.subjectType === REPORT_SUBJECT_TYPES.message,
  ).length;

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
          <CardDescription>{t.adminQueueDescription}</CardDescription>
        </CardHeader>
        <CardContent className="px-6 py-6">
          {openReports.length > 0 ? (
            <ReportQueueTable reports={openReports} language={language} t={t} />
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
        <CardContent className="px-6 py-6">
          {reviewedReports.length > 0 ? (
            <ReportQueueTable reports={reviewedReports.slice(0, 20)} language={language} t={t} />
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
