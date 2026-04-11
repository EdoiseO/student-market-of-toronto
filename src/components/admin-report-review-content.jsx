"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { ClientFormattedDateTime } from "@/components/client-formatted-date-time";
import { ListingDescriptionContent } from "@/components/listing-description-content";
import { ProfileAvatar } from "@/components/profile-avatar";
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
import { Textarea } from "@/components/ui/textarea";
import { useLanguage } from "@/context/LanguageContext";
import {
  REPORT_STATUS_VALUES,
  REPORT_SUBJECT_TYPES,
  getTranslatedReportReason,
  getTranslatedReportStatus,
} from "@/lib/moderation";
import { createClient } from "@/utils/supabase/client";

function ReviewMetadata({ label, children }) {
  return (
    <div className="space-y-1">
      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
        {label}
      </p>
      <div className="text-sm text-foreground">{children}</div>
    </div>
  );
}

function ModeratorNotesCard({
  t,
  language,
  notesAvailable,
  moderatorNotes,
  setModeratorNotes,
  report,
  hasModeratorNotes,
  isSavingNotes,
  hasNotesChanges,
  handleSaveModeratorNotes,
  compact = false,
}) {
  return (
    <Card className="rounded-[2rem] border-zinc-200 bg-white py-0 shadow-sm dark:bg-card dark:ring-border">
      <CardHeader className={`border-b border-zinc-200 dark:border-border ${compact ? "px-4 py-3.5" : "px-6 py-5"}`}>
        <CardTitle className="text-xl text-zinc-950 dark:text-foreground">
          {t.adminModeratorNotesTitle}
        </CardTitle>
        <CardDescription>
          {notesAvailable
            ? t.adminModeratorNotesDescription
            : t.adminModeratorNotesSetupDescription}
        </CardDescription>
      </CardHeader>
      <CardContent className={`space-y-3 ${compact ? "px-4 py-3.5" : "px-6 py-5"}`}>
        {notesAvailable ? (
          <>
            <div className="rounded-xl border border-zinc-200 bg-background p-3 shadow-sm dark:border-border dark:bg-background">
              <Textarea
                value={moderatorNotes}
                onChange={(event) => setModeratorNotes(event.target.value)}
                placeholder={t.adminModeratorNotesPlaceholder}
                rows={compact ? 3 : 6}
                maxLength={4000}
                className={`${compact ? "min-h-20" : "min-h-32"} resize-y border-0 bg-transparent px-2 py-2 shadow-none focus-visible:ring-0`}
              />
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="text-xs text-zinc-500 dark:text-muted-foreground">
                {report.moderatorNotesUpdatedAt ? (
                  <span>
                    {t.adminModeratorNotesUpdatedByPrefix} {report.moderatorNotesUpdatedBy?.name ?? t.unknown} ·{" "}
                    <ClientFormattedDateTime
                      value={report.moderatorNotesUpdatedAt}
                      language={language}
                    />
                  </span>
                ) : hasModeratorNotes ? (
                  <span>{t.adminModeratorNotesUnsavedHint}</span>
                ) : (
                  <span>{t.adminModeratorNotesEmpty}</span>
                )}
              </div>

              <Button
                type="button"
                className="rounded-xl"
                disabled={isSavingNotes || !hasNotesChanges}
                onClick={handleSaveModeratorNotes}
              >
                {isSavingNotes ? t.saving : t.saveNotes}
              </Button>
            </div>
          </>
        ) : (
          <div className="rounded-2xl border border-dashed border-border bg-muted/30 px-4 py-5 text-sm text-muted-foreground">
            {t.adminModeratorNotesSetupHint}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function AdminReportReviewContent({
  report,
  relatedReports = [],
  conversation = null,
  messages = [],
  listingReview = null,
  profileReview = null,
  notesAvailable = false,
  currentUserId,
}) {
  const router = useRouter();
  const supabase = React.useMemo(() => createClient(), []);
  const { t, language } = useLanguage();
  const [isProcessing, setIsProcessing] = React.useState(false);
  const [isSavingNotes, setIsSavingNotes] = React.useState(false);
  const [moderatorNotes, setModeratorNotes] = React.useState(report.moderatorNotes ?? "");

  React.useEffect(() => {
    setModeratorNotes(report.moderatorNotes ?? "");
  }, [report.id, report.moderatorNotes]);

  const isMessageReport = report.subjectType === REPORT_SUBJECT_TYPES.message;
  const isProfileReport = report.subjectType === REPORT_SUBJECT_TYPES.profile;
  const flaggedMessageId = report.message?.id ?? null;
  const sortedRelatedReports = React.useMemo(
    () => [...relatedReports].sort((firstReport, secondReport) => {
      return new Date(secondReport.createdAt ?? 0).getTime() - new Date(firstReport.createdAt ?? 0).getTime();
    }),
    [relatedReports],
  );
  const openRelatedReports = React.useMemo(
    () => sortedRelatedReports.filter((relatedReport) => relatedReport.status === REPORT_STATUS_VALUES.open),
    [sortedRelatedReports],
  );
  const actionableReportIds = React.useMemo(
    () => openRelatedReports.map((relatedReport) => relatedReport.id),
    [openRelatedReports],
  );
  const hasOpenRelatedReports = actionableReportIds.length > 0;
  const hasMultipleOpenRelatedReports = actionableReportIds.length > 1;
  const listingTarget = isMessageReport ? conversation?.listing : listingReview?.listing;
  const profileTarget = profileReview?.profile ?? null;
  const reviewTitle = isProfileReport
    ? profileTarget?.name ?? t.profile
    : listingTarget?.title ?? t.listing;
  const reviewDescription =
    isMessageReport
      ? t.adminReportReviewDescription
      : isProfileReport
        ? t.adminProfileReviewDescription
        : t.adminListingReviewDescription;
  const canRemoveListing = !isProfileReport && listingTarget?.id && listingTarget?.status === "active";
  const dismissActionLabel = hasMultipleOpenRelatedReports ? t.adminDismissAllOpen : t.dismiss;
  const resolveActionLabel = hasMultipleOpenRelatedReports ? t.adminResolveAllOpen : t.resolve;
  const removeListingActionLabel = hasMultipleOpenRelatedReports
    ? t.adminRemoveListingAndResolveAllOpen
    : t.removeListing;
  const hasModeratorNotes = moderatorNotes.trim().length > 0;
  const hasNotesChanges = moderatorNotes !== (report.moderatorNotes ?? "");

  async function updateRelatedReportStatuses(nextStatus) {
    if (!currentUserId || isProcessing || actionableReportIds.length === 0) {
      return { error: true };
    }

    const reviewedAt = new Date().toISOString();
    const { error } = await supabase
      .from("reports")
      .update({
        status: nextStatus,
        reviewed_by: currentUserId,
        reviewed_at: reviewedAt,
      })
      .in("id", actionableReportIds);

    if (error) {
      console.error("Failed to update related moderation reports:", error.message);
      toast.error(t.adminReportActionError);
      return { error: true };
    }

    return { error: false, updatedCount: actionableReportIds.length };
  }

  async function handleUpdateStatus(nextStatus) {
    if (!currentUserId || isProcessing || actionableReportIds.length === 0) {
      return;
    }

    setIsProcessing(true);

    const result = await updateRelatedReportStatuses(nextStatus);

    setIsProcessing(false);

    if (result.error) {
      return;
    }

    if (nextStatus === REPORT_STATUS_VALUES.dismissed) {
      toast.success(
        result.updatedCount > 1 ? t.adminOpenReportsDismissed : t.reportDismissed,
      );
    } else {
      toast.success(
        result.updatedCount > 1 ? t.adminOpenReportsResolved : t.reportResolved,
      );
    }

    router.push("/admin");
    router.refresh();
  }

  async function handleRemoveListing() {
    if (!listingTarget?.id || !currentUserId || isProcessing || actionableReportIds.length === 0) {
      return;
    }

    setIsProcessing(true);

    const { error: listingError } = await supabase
      .from("listings")
      .update({
        status: "inactive",
        moderation_reviewed_at: new Date().toISOString(),
        moderation_reviewed_by: currentUserId,
      })
      .eq("id", listingTarget.id);

    if (listingError) {
      setIsProcessing(false);
      console.error("Failed to remove reported listing:", listingError.message);
      toast.error(t.adminReportActionError);
      return;
    }

    const result = await updateRelatedReportStatuses(REPORT_STATUS_VALUES.resolved);

    setIsProcessing(false);

    if (result.error) {
      return;
    }

    toast.success(
      result.updatedCount > 1
        ? t.adminListingRemovedAndAllResolved
        : t.adminListingRemovedAndResolved,
    );
    router.push("/admin");
    router.refresh();
  }

  async function handleSaveModeratorNotes() {
    if (!notesAvailable || !currentUserId || !report?.id || isSavingNotes || !hasNotesChanges) {
      return;
    }

    setIsSavingNotes(true);

    const trimmedNotes = moderatorNotes.trim();
    const { error } = await supabase
      .from("reports")
      .update({
        moderator_notes: trimmedNotes || null,
        moderator_notes_updated_at: new Date().toISOString(),
        moderator_notes_updated_by: currentUserId,
      })
      .eq("id", report.id);

    setIsSavingNotes(false);

    if (error) {
      console.error("Failed to save moderator notes:", error.message);
      toast.error(t.adminModeratorNotesSaveError);
      return;
    }

    toast.success(t.adminModeratorNotesSaved);
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-4">
      <Card className="rounded-[2rem] border-zinc-200 bg-white py-0 shadow-sm dark:bg-card dark:ring-border">
        <CardHeader className="border-b border-zinc-200 px-6 py-5 dark:border-border">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline" className="rounded-full border-border bg-background px-2.5 py-0.5 text-foreground">
                  {sortedRelatedReports.length} {t.adminReportsCountLabel}
                </Badge>
                {openRelatedReports.length > 0 ? (
                  <Badge className="rounded-full bg-primary/10 px-2.5 py-0.5 text-primary shadow-none dark:bg-primary/15">
                    {openRelatedReports.length} {t.adminOpenCountLabel}
                  </Badge>
                ) : null}
                <Badge variant="outline" className="rounded-full border-border bg-background px-2.5 py-0.5 text-foreground">
                  {getTranslatedReportReason(report.reason, t, report.subjectType)}
                </Badge>
                <Badge variant="outline" className="rounded-full border-border bg-background px-2.5 py-0.5 text-foreground">
                  {getTranslatedReportStatus(report.status, t)}
                </Badge>
                {flaggedMessageId ? (
                  <Badge className="rounded-full bg-yellow-500 px-2.5 py-0.5 text-zinc-950 shadow-none">
                    {t.adminReportedMessageBadge}
                  </Badge>
                ) : null}
              </div>
              <CardTitle className="text-2xl text-zinc-950 dark:text-foreground">
                {reviewTitle}
              </CardTitle>
              <CardDescription>{reviewDescription}</CardDescription>
            </div>
            <div className="text-right text-xs text-muted-foreground">
              <p>{t.reportedAt}</p>
              <ClientFormattedDateTime value={report.createdAt} language={language} />
            </div>
          </div>
        </CardHeader>

        <CardContent className="grid gap-4 px-6 py-5 md:grid-cols-2 xl:grid-cols-6">
          <ReviewMetadata label={t.reporter}>{report.reporter.name}</ReviewMetadata>
          <ReviewMetadata label={t.adminReportedUser}>{report.reportedUser.name}</ReviewMetadata>
          <ReviewMetadata label={t.adminReason}>
            {getTranslatedReportReason(report.reason, t, report.subjectType)}
          </ReviewMetadata>
          <ReviewMetadata label={t.status}>{getTranslatedReportStatus(report.status, t)}</ReviewMetadata>
          <ReviewMetadata label={t.adminGroupedReports}>{sortedRelatedReports.length}</ReviewMetadata>
          <ReviewMetadata label={t.adminOpenCountLabel}>{openRelatedReports.length}</ReviewMetadata>
          {report.reviewedBy ? (
            <ReviewMetadata label={t.adminReviewedBy}>{report.reviewedBy.name}</ReviewMetadata>
          ) : null}
          {report.reviewedAt ? (
            <ReviewMetadata label={t.reviewedAt}>
              <ClientFormattedDateTime value={report.reviewedAt} language={language} />
            </ReviewMetadata>
          ) : null}
          {report.details ? (
            <div className="md:col-span-2 xl:col-span-6">
              <ReviewMetadata label={t.adminDetails}>{report.details}</ReviewMetadata>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.45fr)_minmax(300px,0.8fr)]">
        {isMessageReport ? (
          <section className="flex flex-col overflow-hidden rounded-[2rem] border border-zinc-200 bg-white shadow-sm dark:border-border dark:bg-card">
            <div className="border-b border-zinc-200 px-6 py-4 dark:border-border">
              <p className="text-lg font-semibold text-zinc-950 dark:text-foreground">
                {t.adminConversationContextLabel}
              </p>
              <p className="mt-1 text-sm text-zinc-500 dark:text-muted-foreground">
                {t.adminConversationContextDescription}
              </p>
            </div>

            <div className="max-h-[60vh] space-y-5 overflow-y-auto bg-zinc-50/70 px-6 py-5 dark:bg-muted/20">
              {messages.map((message) => {
                const isBuyer = message.sender_id === conversation.buyer.id;
                const sender = isBuyer ? conversation.buyer : conversation.seller;
                const isFlagged = message.id === flaggedMessageId;

                return (
                  <div key={message.id} className={`flex items-end gap-3 ${isBuyer ? "" : "flex-row-reverse"}`}>
                    <ProfileAvatar
                      name={sender.name}
                      avatarPresetId={sender.avatarPresetId}
                      avatarUrl={sender.avatarUrl}
                      className="size-10 border border-zinc-200 shadow-sm dark:border-border"
                    />

                    <div className={`relative flex max-w-[85%] flex-col gap-1.5 sm:max-w-[70%] ${isBuyer ? "items-start" : "items-end"}`}>
                      <p className="px-1 text-xs text-zinc-500 dark:text-muted-foreground">
                        <span className="font-semibold text-zinc-900 dark:text-foreground">
                          {sender.name}
                        </span>{" "}
                        <ClientFormattedDateTime value={message.created_at} language={language} />
                      </p>

                      <div
                        className={`w-fit rounded-[1.5rem] px-4 py-3 text-left shadow-sm ${
                          isFlagged
                            ? "border border-yellow-400 bg-yellow-50 text-zinc-950 dark:border-yellow-500/60 dark:bg-yellow-500/10 dark:text-foreground"
                            : isBuyer
                              ? "rounded-tl-md border border-zinc-200 bg-white text-zinc-900 dark:border-border dark:bg-card dark:text-foreground"
                              : "rounded-tr-md bg-primary text-primary-foreground"
                        }`}
                      >
                        {isFlagged ? (
                          <div className="mb-2">
                            <Badge className="rounded-full bg-yellow-500 px-2 py-0 text-zinc-950 shadow-none">
                              {t.adminReportedMessageBadge}
                            </Badge>
                          </div>
                        ) : null}
                        <p className="whitespace-pre-wrap break-words text-sm leading-6">
                          {message.body}
                        </p>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="border-t border-zinc-200 bg-background px-5 py-4 dark:border-border">
              <ModeratorNotesCard
                t={t}
                language={language}
                notesAvailable={notesAvailable}
                moderatorNotes={moderatorNotes}
                setModeratorNotes={setModeratorNotes}
                report={report}
                hasModeratorNotes={hasModeratorNotes}
                isSavingNotes={isSavingNotes}
                hasNotesChanges={hasNotesChanges}
                handleSaveModeratorNotes={handleSaveModeratorNotes}
                compact
              />
            </div>

            <div className="border-t border-zinc-200 bg-background px-6 py-4 dark:border-border">
              <div className="flex flex-wrap justify-end gap-2">
                {canRemoveListing ? (
                  <Button
                    type="button"
                    variant="outline"
                    className="rounded-xl"
                    onClick={handleRemoveListing}
                    disabled={isProcessing || !hasOpenRelatedReports}
                  >
                    {removeListingActionLabel}
                  </Button>
                ) : null}
                <Button
                  type="button"
                  variant="outline"
                  className="rounded-xl"
                  onClick={() => handleUpdateStatus(REPORT_STATUS_VALUES.dismissed)}
                  disabled={isProcessing || !hasOpenRelatedReports}
                >
                  {dismissActionLabel}
                </Button>
                <Button
                  type="button"
                  className="rounded-xl"
                  onClick={() => handleUpdateStatus(REPORT_STATUS_VALUES.resolved)}
                  disabled={isProcessing || !hasOpenRelatedReports}
                >
                  {resolveActionLabel}
                </Button>
              </div>
            </div>
          </section>
        ) : isProfileReport ? (
          <section className="flex flex-col overflow-hidden rounded-[2rem] border border-zinc-200 bg-white shadow-sm dark:border-border dark:bg-card">
            <div className="border-b border-zinc-200 px-6 py-5 dark:border-border">
              <p className="text-lg font-semibold text-zinc-950 dark:text-foreground">
                {reviewTitle}
              </p>
              <p className="mt-1 text-sm text-zinc-500 dark:text-muted-foreground">
                {reviewDescription}
              </p>
            </div>

            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto bg-zinc-50/70 px-6 py-5 dark:bg-muted/20">
              <Card className="rounded-[1.75rem] border-zinc-200 bg-white py-0 shadow-none dark:bg-card dark:ring-border">
                <CardHeader className="border-b border-zinc-200 px-6 py-5 dark:border-border">
                  <CardTitle className="text-2xl text-zinc-950 dark:text-foreground">
                    {t.adminReportedProfileTitle}
                  </CardTitle>
                </CardHeader>
                <CardContent className="px-6 py-6">
                  <Link href={`/profile/${profileTarget?.id}`} className="flex items-center gap-4 rounded-2xl bg-zinc-50 p-4 transition hover:bg-background dark:bg-muted/40 dark:hover:bg-background">
                    <ProfileAvatar
                      name={profileTarget?.name}
                      avatarPresetId={profileTarget?.avatarPresetId}
                      avatarUrl={profileTarget?.avatarUrl}
                      className="size-16 border border-zinc-200 dark:border-border"
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xl font-semibold text-zinc-950 dark:text-foreground">
                        {profileTarget?.name}
                      </p>
                      <p className="mt-1 text-sm text-zinc-500 dark:text-muted-foreground">
                        {profileTarget?.school || t.torontoStudent}
                      </p>
                    </div>
                  </Link>
                </CardContent>
              </Card>

              <Card className="rounded-[1.75rem] border-zinc-200 bg-white py-0 shadow-none dark:bg-card dark:ring-border">
                <CardHeader className="border-b border-zinc-200 px-6 py-5 dark:border-border">
                  <CardTitle className="text-2xl text-zinc-950 dark:text-foreground">
                    {t.profileDescriptionTitle}
                  </CardTitle>
                </CardHeader>
                <CardContent className="px-6 py-6">
                  <p className="whitespace-pre-line text-sm leading-6 text-zinc-600 dark:text-muted-foreground">
                    {profileTarget?.bio || t.profileNoBio}
                  </p>
                </CardContent>
              </Card>

            </div>

            <div className="border-t border-zinc-200 bg-background px-6 py-5 dark:border-border">
              <div className="flex flex-wrap justify-end gap-2">
                <Button
                  type="button"
                  variant="outline"
                  className="rounded-xl"
                  onClick={() => handleUpdateStatus(REPORT_STATUS_VALUES.dismissed)}
                  disabled={isProcessing || !hasOpenRelatedReports}
                >
                  {dismissActionLabel}
                </Button>
                <Button
                  type="button"
                  className="rounded-xl"
                  onClick={() => handleUpdateStatus(REPORT_STATUS_VALUES.resolved)}
                  disabled={isProcessing || !hasOpenRelatedReports}
                >
                  {resolveActionLabel}
                </Button>
              </div>
            </div>
          </section>
        ) : (
          <section className="flex flex-col overflow-hidden rounded-[2rem] border border-zinc-200 bg-white shadow-sm dark:border-border dark:bg-card">
            <div className="border-b border-zinc-200 px-6 py-5 dark:border-border">
              <p className="text-lg font-semibold text-zinc-950 dark:text-foreground">
                {t.adminListingReviewTitle}
              </p>
              <p className="mt-1 text-sm text-zinc-500 dark:text-muted-foreground">
                {t.adminListingReviewDescription}
              </p>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto bg-zinc-50/70 px-6 py-5 dark:bg-muted/20">
              <div className="space-y-5">
                <div className="rounded-[1.75rem] border border-zinc-200 bg-white p-5 dark:border-border dark:bg-card">
                  <div className="flex items-start gap-4">
                    <div className="h-24 w-24 shrink-0 overflow-hidden rounded-2xl bg-zinc-100 dark:bg-muted">
                      {listingReview?.listing?.imageUrl ? (
                        <img
                          src={listingReview.listing.imageUrl}
                          alt={listingReview.listing.title}
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <div className="h-full w-full bg-zinc-100 dark:bg-muted" />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-xl font-semibold text-zinc-950 dark:text-foreground">
                        {listingReview?.listing?.title}
                      </p>
                      <p className="mt-1 text-sm text-zinc-500 dark:text-muted-foreground">
                        {listingReview?.listing?.location || t.torontoMeetup}
                      </p>
                    </div>
                  </div>
                </div>

                {listingReview?.listing?.description ? (
                  <Card className="rounded-[1.75rem] border-zinc-200 bg-white py-0 shadow-none dark:bg-card dark:ring-border">
                    <CardHeader className="border-b border-zinc-200 px-6 py-5 dark:border-border">
                      <CardTitle className="text-2xl text-zinc-950 dark:text-foreground">
                        {t.description}
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="px-6 py-6">
                      <ListingDescriptionContent description={listingReview.listing.description} className="whitespace-normal leading-6 text-sm" />
                    </CardContent>
                  </Card>
                ) : null}
              </div>
            </div>
            <div className="border-t border-zinc-200 bg-background px-6 py-5 dark:border-border">
              <div className="flex flex-wrap justify-end gap-2">
                {canRemoveListing ? (
                  <Button
                    type="button"
                    variant="outline"
                    className="rounded-xl"
                    onClick={handleRemoveListing}
                    disabled={isProcessing || !hasOpenRelatedReports}
                  >
                    {removeListingActionLabel}
                  </Button>
                ) : null}
                <Button
                  type="button"
                  variant="outline"
                  className="rounded-xl"
                  onClick={() => handleUpdateStatus(REPORT_STATUS_VALUES.dismissed)}
                  disabled={isProcessing || !hasOpenRelatedReports}
                >
                  {dismissActionLabel}
                </Button>
                <Button
                  type="button"
                  className="rounded-xl"
                  onClick={() => handleUpdateStatus(REPORT_STATUS_VALUES.resolved)}
                  disabled={isProcessing || !hasOpenRelatedReports}
                >
                  {resolveActionLabel}
                </Button>
              </div>
            </div>
          </section>
        )}
      
        <div className="space-y-4">
          {!isMessageReport ? (
            <ModeratorNotesCard
              t={t}
              language={language}
              notesAvailable={notesAvailable}
              moderatorNotes={moderatorNotes}
              setModeratorNotes={setModeratorNotes}
              report={report}
              hasModeratorNotes={hasModeratorNotes}
              isSavingNotes={isSavingNotes}
              hasNotesChanges={hasNotesChanges}
              handleSaveModeratorNotes={handleSaveModeratorNotes}
            />
          ) : null}

          <Card className="rounded-[2rem] border-zinc-200 bg-white py-0 shadow-sm dark:bg-card dark:ring-border">
            <CardHeader className="border-b border-zinc-200 px-6 py-5 dark:border-border">
              <CardTitle className="text-xl text-zinc-950 dark:text-foreground">
                {t.adminRelatedReportsTitle}
              </CardTitle>
              <CardDescription>{t.adminRelatedReportsDescription}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 px-6 py-5">
              {sortedRelatedReports.length > 0 ? (
                sortedRelatedReports.map((relatedReport) => {
                  const isCurrentReport = relatedReport.id === report.id;

                  return (
                    <Link
                      key={relatedReport.id}
                      href={`/admin/reports/${relatedReport.id}`}
                      className={`block rounded-2xl border p-4 transition ${
                        isCurrentReport
                          ? "border-primary/40 bg-primary/5"
                          : "border-zinc-200 bg-zinc-50 hover:bg-background dark:border-border dark:bg-muted/40 dark:hover:bg-background"
                      }`}
                    >
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="space-y-2">
                          <div className="flex flex-wrap items-center gap-2">
                            <Badge variant="outline" className="rounded-full border-border bg-background px-2 py-0 text-foreground">
                              {getTranslatedReportReason(relatedReport.reason, t, relatedReport.subjectType)}
                            </Badge>
                            <Badge variant="outline" className="rounded-full border-border bg-background px-2 py-0 text-foreground">
                              {getTranslatedReportStatus(relatedReport.status, t)}
                            </Badge>
                            {isCurrentReport ? (
                              <Badge className="rounded-full bg-primary px-2 py-0 text-primary-foreground shadow-none">
                                {t.adminCurrentReport}
                              </Badge>
                            ) : null}
                          </div>

                          <p className="text-sm font-medium text-zinc-950 dark:text-foreground">
                            {relatedReport.reporter.name}
                          </p>

                          {relatedReport.reviewedBy || relatedReport.reviewedAt ? (
                            <p className="text-xs text-zinc-500 dark:text-muted-foreground">
                              {relatedReport.reviewedBy
                                ? `${t.adminReviewedBy}: ${relatedReport.reviewedBy.name}`
                                : t.reviewedAt}
                              {relatedReport.reviewedAt ? (
                                <>
                                  {" "}· <ClientFormattedDateTime value={relatedReport.reviewedAt} language={language} />
                                </>
                              ) : null}
                            </p>
                          ) : null}

                          {relatedReport.moderatorNotes ? (
                            <p className="line-clamp-2 text-xs text-zinc-500 dark:text-muted-foreground">
                              {relatedReport.moderatorNotes}
                            </p>
                          ) : null}

                          {relatedReport.details ? (
                            <p className="line-clamp-2 text-sm text-zinc-500 dark:text-muted-foreground">
                              {relatedReport.details}
                            </p>
                          ) : null}
                        </div>

                        <div className="text-right text-xs text-zinc-500 dark:text-muted-foreground">
                          <ClientFormattedDateTime value={relatedReport.createdAt} language={language} />
                        </div>
                      </div>
                    </Link>
                  );
                })
              ) : (
                <p className="text-sm text-zinc-500 dark:text-muted-foreground">
                  {t.adminNoRelatedReports}
                </p>
              )}
            </CardContent>
          </Card>

          {isProfileReport ? (
            <Card className="rounded-[2rem] border-zinc-200 bg-white py-0 shadow-sm dark:bg-card dark:ring-border">
              <CardHeader className="border-b border-zinc-200 px-6 py-5 dark:border-border">
                <CardTitle className="text-xl text-zinc-950 dark:text-foreground">
                  {t.adminReportedProfileTitle}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4 px-6 py-5">
                <Link href={`/profile/${profileTarget?.id}`} className="flex items-center gap-3 rounded-xl transition hover:bg-zinc-50/80 dark:hover:bg-muted/40">
                  <ProfileAvatar
                    name={profileTarget?.name}
                    avatarPresetId={profileTarget?.avatarPresetId}
                    avatarUrl={profileTarget?.avatarUrl}
                    className="size-10 border border-zinc-200 dark:border-border"
                  />
                  <div>
                    <p className="font-medium text-zinc-950 dark:text-foreground">{profileTarget?.name}</p>
                    <p className="text-sm text-zinc-500 dark:text-muted-foreground">{profileTarget?.school}</p>
                  </div>
                </Link>
                <Separator />
                <ReviewMetadata label={t.memberSince}>
                  {profileTarget?.createdAt ? (
                    <ClientFormattedDateTime value={profileTarget.createdAt} language={language} />
                  ) : (
                    "—"
                  )}
                </ReviewMetadata>
                <Button asChild variant="outline" className="w-full rounded-xl">
                  <Link href={`/profile/${profileTarget?.id}`}>{t.viewProfile}</Link>
                </Button>
              </CardContent>
            </Card>
          ) : (
            <>
              <Card className="rounded-[2rem] border-zinc-200 bg-white py-0 shadow-sm dark:bg-card dark:ring-border">
                <CardHeader className="border-b border-zinc-200 px-6 py-5 dark:border-border">
                  <CardTitle className="text-xl text-zinc-950 dark:text-foreground">
                    {t.aboutListing}
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4 px-6 py-5">
                  <Link href={`/listings/${listingTarget.slug}`} className="block rounded-2xl bg-zinc-50 p-4 transition hover:bg-background dark:bg-muted/40 dark:hover:bg-background">
                    <div className="flex items-center gap-4">
                      <div className="h-18 w-18 shrink-0 overflow-hidden rounded-2xl bg-zinc-100 dark:bg-muted">
                        {listingTarget?.imageUrl ? (
                          <img
                            src={listingTarget.imageUrl}
                            alt={listingTarget.title}
                            className="h-full w-full object-cover"
                          />
                        ) : (
                          <div className="h-full w-full bg-zinc-100 dark:bg-muted" />
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-base font-semibold text-zinc-950 dark:text-foreground">
                          {listingTarget?.title}
                        </p>
                        <p className="mt-1 text-sm text-zinc-500 dark:text-muted-foreground">
                          {listingTarget?.location || t.torontoMeetup}
                        </p>
                      </div>
                    </div>
                  </Link>
                </CardContent>
              </Card>

              <Card className="rounded-[2rem] border-zinc-200 bg-white py-0 shadow-sm dark:bg-card dark:ring-border">
                <CardHeader className="border-b border-zinc-200 px-6 py-5 dark:border-border">
                  <CardTitle className="text-xl text-zinc-950 dark:text-foreground">
                    {isMessageReport ? t.adminParticipantsTitle : t.seller}
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4 px-6 py-5">
                  {(isMessageReport ? [conversation.buyer, conversation.seller] : [listingReview?.seller])
                    .filter(Boolean)
                    .map((participant, index) => (
                      <React.Fragment key={participant.id}>
                        {index > 0 ? <Separator /> : null}
                        <Link href={`/profile/${participant.id}`} className="flex items-center gap-3 rounded-xl transition hover:bg-zinc-50/80 dark:hover:bg-muted/40">
                          <ProfileAvatar
                            name={participant.name}
                            avatarPresetId={participant.avatarPresetId}
                            avatarUrl={participant.avatarUrl}
                            className="size-10 border border-zinc-200 dark:border-border"
                          />
                          <div>
                            <p className="font-medium text-zinc-950 dark:text-foreground">{participant.name}</p>
                            <p className="text-sm text-zinc-500 dark:text-muted-foreground">{participant.school}</p>
                          </div>
                        </Link>
                      </React.Fragment>
                    ))}
                </CardContent>
              </Card>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
