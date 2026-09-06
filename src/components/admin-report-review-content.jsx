"use client";

import * as React from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { ClientFormattedDateTime } from "@/components/client-formatted-date-time";
import { ListingReviewImages } from "@/components/listing-review-images";
import { ListingDescriptionContent } from "@/components/listing-description-content";
import { ProfileAvatar } from "@/components/profile-avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { useLanguage } from "@/context/LanguageContext";
import { REMOTE_IMAGE_BLUR_DATA_URL } from "@/lib/image-config";
import {
  REPORT_STATUS_VALUES,
  REPORT_SUBJECT_TYPES,
  getTranslatedReportReason,
  getTranslatedReportStatus,
} from "@/lib/moderation";
import {
  FORCE_NAME_POLICY_REASON_MAX_LENGTH,
  FORCE_NAME_USER_MESSAGE_MAX_LENGTH,
  MODERATOR_NOTE_MAX_LENGTH,
  REPORTED_LISTING_FEEDBACK_MAX_LENGTH,
  REPORTED_LISTING_PRIVATE_SUMMARY_MAX_LENGTH,
  REPORT_DECISION_SUMMARY_MAX_LENGTH,
  validateForceNameDecision,
  validateModeratorNoteEntry,
  validateReportDecisionSummary,
  validateReportedListingDecision,
} from "@/lib/write-field-contracts.mjs";

const REPORT_EVIDENCE_PANEL_CLASS =
  "flex flex-col overflow-hidden rounded-2xl sm:rounded-[2rem] border border-zinc-200 bg-white shadow-sm dark:border-border dark:bg-card xl:h-[clamp(28rem,60vh,34rem)]";

function DecisionTextField({
  id,
  label,
  description,
  value,
  onChange,
  textareaRef,
  limit,
  error,
  required = false,
  rows = 4,
}) {
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div className="lg:min-h-[4.75rem]">
        <label htmlFor={id} className="text-sm font-semibold text-foreground">
          {label}
        </label>
        <p id={`${id}-description`} className="mt-1 text-xs leading-5 text-muted-foreground">
          {description}
        </p>
      </div>
      <Textarea
        ref={textareaRef}
        id={id}
        value={value}
        onChange={onChange}
        rows={rows}
        required={required}
        aria-invalid={Boolean(error)}
        aria-describedby={`${id}-description${error ? ` ${id}-error` : ""}`}
        className="min-h-32 resize-y rounded-xl"
      />
      <div className="flex items-start justify-between gap-3 text-xs">
        {error ? (
          <p id={`${id}-error`} role="alert" className="text-destructive">
            {error}
          </p>
        ) : (
          <span />
        )}
        <span className="shrink-0 text-muted-foreground">
          {Array.from(value).length}/{limit}
        </span>
      </div>
    </div>
  );
}

function ReportDecisionActions({
  t,
  canRemoveListing,
  canForceNameChange,
  isProcessing,
  hasOpenRelatedReports,
  removeListingActionLabel,
  dismissActionLabel,
  resolveActionLabel,
  handleRemoveListing,
  handleForceNameChange,
  handleUpdateStatus,
}) {
  return (
    <div className="flex w-full flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <p className="max-w-xl text-xs leading-5 text-muted-foreground">
        {t.adminDecisionActionSaveHint}
      </p>
      <div className="flex flex-wrap justify-start gap-2 sm:justify-end">
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
        {canForceNameChange ? (
          <Button
            type="button"
            variant="outline"
            className="rounded-xl"
            onClick={handleForceNameChange}
            disabled={isProcessing}
          >
            {t.adminForceNameChange}
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
  );
}

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
  moderatorNoteDraft,
  setModeratorNoteDraft,
  moderatorNoteHistory,
  moderatorNoteHistoryNextHref,
  isSavingNotes,
  hasNoteDraft,
  handleSaveModeratorNotes,
}) {
  return (
    <Card id="moderator-notes" className="scroll-mt-24 rounded-2xl sm:rounded-[2rem] border-zinc-200 bg-white py-0 shadow-sm dark:bg-card dark:ring-border">
      <CardHeader className="border-b border-zinc-200 px-4 py-4 sm:px-7 sm:py-6 dark:border-border">
        <CardTitle className="text-xl text-zinc-950 dark:text-foreground">
          {t.adminModeratorNotesTitle}
        </CardTitle>
        <CardDescription>
          {notesAvailable
            ? t.adminModeratorNotesDescription
            : t.adminModeratorNotesSetupDescription}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 px-4 py-4 sm:px-7 sm:py-6">
        {notesAvailable ? (
          <>
            <div className="space-y-3 rounded-2xl border border-zinc-200 bg-zinc-50/70 p-4 dark:border-border dark:bg-muted/20">
              <div>
                <label htmlFor="moderator-note-entry" className="text-sm font-semibold text-foreground">
                  {t.adminModeratorNotesComposerLabel}
                </label>
                <p id="moderator-note-entry-description" className="mt-1 text-xs leading-5 text-muted-foreground">
                  {t.adminModeratorNotesComposerDescription}
                </p>
              </div>
              <Textarea
                id="moderator-note-entry"
                value={moderatorNoteDraft}
                onChange={(event) => setModeratorNoteDraft(event.target.value)}
                placeholder={t.adminModeratorNotesPlaceholder}
                rows={4}
                aria-describedby="moderator-note-entry-description"
                className="min-h-28 max-h-64 resize-y rounded-xl bg-background"
              />
              <div className="flex flex-wrap items-center justify-between gap-3">
                <span className="text-xs text-muted-foreground">
                  {Array.from(moderatorNoteDraft).length}/{MODERATOR_NOTE_MAX_LENGTH}
                </span>
                <Button
                  type="button"
                  className="rounded-xl"
                  disabled={isSavingNotes || !hasNoteDraft}
                  onClick={handleSaveModeratorNotes}
                >
                  {isSavingNotes ? t.saving : t.saveNotes}
                </Button>
              </div>
            </div>

            <Separator />

            <section aria-labelledby="moderator-note-history-title" className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 id="moderator-note-history-title" className="text-sm font-semibold text-foreground">
                  {t.adminModeratorNotesHistoryTitle}
                </h3>
                <Badge variant="outline" className="rounded-full bg-background">
                  {moderatorNoteHistory.length} {t.adminModeratorNotesCountLabel}
                </Badge>
              </div>

              {moderatorNoteHistory.length > 0 ? (
                <div className="space-y-3">
                  {moderatorNoteHistory.map((note) => (
                    <article
                      key={note.id}
                      className="rounded-2xl border border-zinc-200 bg-background p-4 dark:border-border"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                        <span className="font-semibold text-foreground">{note.createdBy.name}</span>
                        <ClientFormattedDateTime value={note.createdAt} language={language} />
                      </div>
                      <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-foreground">
                        {note.body}
                      </p>
                    </article>
                  ))}
                </div>
              ) : (
                <div className="rounded-2xl border border-dashed border-border bg-muted/20 px-4 py-5 text-sm text-muted-foreground">
                  {t.adminModeratorNotesEmpty}
                </div>
              )}

              {moderatorNoteHistoryNextHref ? (
                <Button asChild variant="outline" className="w-full rounded-xl">
                  <Link href={moderatorNoteHistoryNextHref} scroll={false}>
                    {t.adminModeratorNotesLoadOlder}
                  </Link>
                </Button>
              ) : null}
            </section>
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
  moderatorNoteHistory = [],
  moderatorNoteHistoryNextHref = null,
  currentUserId,
  canForceProfileNameChange = false,
  canDecide = true,
  returnHref = "/admin/reports",
}) {
  const router = useRouter();
  const { t, language } = useLanguage();
  const [isProcessing, setIsProcessing] = React.useState(false);
  const [isSavingNotes, setIsSavingNotes] = React.useState(false);
  const [moderatorNoteDraft, setModeratorNoteDraft] = React.useState("");
  const [decisionSummary, setDecisionSummary] = React.useState("");
  const [sellerFeedback, setSellerFeedback] = React.useState("");
  const [removalPrivateSummary, setRemovalPrivateSummary] = React.useState("");
  const [forcePolicyReason, setForcePolicyReason] = React.useState("");
  const [forceUserMessage, setForceUserMessage] = React.useState("");
  const [forcePrivateNote, setForcePrivateNote] = React.useState("");
  const [fieldErrors, setFieldErrors] = React.useState({});
  const reportStatusOperationRef = React.useRef(null);
  const removeListingOperationRef = React.useRef(null);
  const forceNameOperationRef = React.useRef(null);
  const notesOperationRef = React.useRef(null);
  const decisionSummaryRef = React.useRef(null);
  const sellerFeedbackRef = React.useRef(null);
  const removalPrivateSummaryRef = React.useRef(null);
  const forcePolicyReasonRef = React.useRef(null);
  const forceUserMessageRef = React.useRef(null);
  const forcePrivateNoteRef = React.useRef(null);

  React.useEffect(() => {
    setModeratorNoteDraft("");
    notesOperationRef.current = null;
  }, [report.id]);

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
  const canForceNameChange =
    canForceProfileNameChange && isProfileReport && Boolean(profileTarget?.id) && hasOpenRelatedReports;
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
  const dismissActionLabel = hasMultipleOpenRelatedReports
    ? t.adminCloseAllOpenNoAction
    : t.adminCloseReportNoAction;
  const resolveActionLabel = hasMultipleOpenRelatedReports
    ? t.adminMarkAllOpenAddressed
    : t.adminMarkReportAddressed;
  const removeListingActionLabel = hasMultipleOpenRelatedReports
    ? t.adminRemoveListingAndResolveAllOpen
    : t.removeListing;
  const hasNoteDraft = moderatorNoteDraft.trim().length > 0;

  async function updateRelatedReportStatuses(nextStatus, privateSummary) {
    if (!currentUserId || isProcessing || actionableReportIds.length === 0) {
      return { error: true };
    }

    const operationPayloadKey = JSON.stringify({
      action: "update_status",
      reportIds: [...actionableReportIds].sort(),
      status: nextStatus,
      decisionSummary: privateSummary,
    });
    if (reportStatusOperationRef.current?.payloadKey !== operationPayloadKey) {
      reportStatusOperationRef.current = {
        payloadKey: operationPayloadKey,
        operationId: crypto.randomUUID(),
      };
    }

    const response = await fetch("/api/admin/reports/actions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        operationId: reportStatusOperationRef.current.operationId,
        action: "update_status",
        reportIds: actionableReportIds,
        status: nextStatus,
        decisionSummary: privateSummary,
      }),
    });

    const payload = await response.json().catch(() => ({}));

    if (!response.ok) {
      console.error("Failed to update related moderation reports:", payload?.error);
      toast.error(t.adminReportActionError);
      return { error: true };
    }

    reportStatusOperationRef.current = null;
    return { error: false, updatedCount: payload?.updatedCount ?? actionableReportIds.length };
  }

  async function handleUpdateStatus(nextStatus) {
    if (!currentUserId || isProcessing || actionableReportIds.length === 0) {
      return;
    }

    const summaryResult = validateReportDecisionSummary(decisionSummary);
    if (!summaryResult.ok) {
      setFieldErrors((current) => ({
        ...current,
        decisionSummary: t.adminReportDecisionSummaryValidation,
      }));
      decisionSummaryRef.current?.focus();
      return;
    }

    setFieldErrors((current) => ({ ...current, decisionSummary: "" }));
    setIsProcessing(true);

    const result = await updateRelatedReportStatuses(nextStatus, summaryResult.value);

    setIsProcessing(false);

    if (result.error) {
      return;
    }

    if (nextStatus === REPORT_STATUS_VALUES.dismissed) {
      toast.success(
        result.updatedCount > 1 ? t.adminOpenReportsClosedNoAction : t.adminReportClosedNoAction,
      );
    } else {
      toast.success(
        result.updatedCount > 1 ? t.adminOpenReportsMarkedAddressed : t.adminReportMarkedAddressed,
      );
    }

    router.push(returnHref);
    router.refresh();
  }

  async function handleRemoveListing() {
    if (!listingTarget?.id || !currentUserId || isProcessing || actionableReportIds.length === 0) {
      return;
    }

    const decisionResult = validateReportedListingDecision({
      sellerFeedback,
      privateSummary: removalPrivateSummary,
    });
    if (!decisionResult.ok) {
      const errorKey = decisionResult.error === "seller_feedback"
        ? "sellerFeedback"
        : "removalPrivateSummary";
      setFieldErrors((current) => ({
        ...current,
        [errorKey]: decisionResult.error === "seller_feedback"
          ? t.adminRemoveListingFeedbackValidation
          : t.adminRemoveListingPrivateSummaryDescription,
      }));
      (errorKey === "sellerFeedback"
        ? sellerFeedbackRef
        : removalPrivateSummaryRef).current?.focus();
      return;
    }

    setFieldErrors((current) => ({
      ...current,
      sellerFeedback: "",
      removalPrivateSummary: "",
    }));
    setIsProcessing(true);

    const operationPayloadKey = JSON.stringify({
      listingId: listingTarget.id,
      reportIds: [...actionableReportIds].sort(),
      sellerFeedback: decisionResult.value.sellerFeedback,
      privateSummary: decisionResult.value.privateSummary,
    });

    if (removeListingOperationRef.current?.payloadKey !== operationPayloadKey) {
      removeListingOperationRef.current = {
        payloadKey: operationPayloadKey,
        operationId: crypto.randomUUID(),
      };
    }

    const response = await fetch("/api/admin/reports/actions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        operationId: removeListingOperationRef.current.operationId,
        action: "remove_listing",
        listingId: listingTarget.id,
        reportIds: actionableReportIds,
        sellerFeedback: decisionResult.value.sellerFeedback,
        privateSummary: decisionResult.value.privateSummary,
      }),
    });

    const payload = await response.json().catch(() => ({}));

    if (!response.ok) {
      setIsProcessing(false);
      console.error("Failed to remove reported listing:", payload?.error);
      toast.error(t.adminReportActionError);
      return;
    }

    const result = { error: false, updatedCount: payload?.updatedCount ?? actionableReportIds.length };

    removeListingOperationRef.current = null;
    setIsProcessing(false);

    toast.success(
      result.updatedCount > 1
        ? t.adminListingRemovedAndAllResolved
        : t.adminListingRemovedAndResolved,
    );
    router.push(returnHref);
    router.refresh();
  }

  async function handleForceNameChange() {
    if (!canForceNameChange || isProcessing) {
      return;
    }

    const decisionResult = validateForceNameDecision({
      policyReason: forcePolicyReason,
      userMessage: forceUserMessage,
      privateNote: forcePrivateNote,
    });
    if (!decisionResult.ok) {
      const fieldByError = {
        policy_reason: ["forcePolicyReason", forcePolicyReasonRef],
        user_message: ["forceUserMessage", forceUserMessageRef],
        private_note: ["forcePrivateNote", forcePrivateNoteRef],
      };
      const [field, fieldRef] = fieldByError[decisionResult.error];
      setFieldErrors((current) => ({
        ...current,
        [field]: decisionResult.error === "private_note"
          ? t.adminForceNamePrivateNoteDescription
          : decisionResult.error === "policy_reason"
            ? t.adminForceNamePolicyReasonDescription
            : t.adminForceNameUserMessageDescription,
      }));
      fieldRef.current?.focus();
      return;
    }

    setFieldErrors((current) => ({
      ...current,
      forcePolicyReason: "",
      forceUserMessage: "",
      forcePrivateNote: "",
    }));
    setIsProcessing(true);

    const operationPayloadKey = JSON.stringify({
      userId: profileTarget.id,
      reportIds: [...actionableReportIds].sort(),
      ...decisionResult.value,
    });

    if (forceNameOperationRef.current?.payloadKey !== operationPayloadKey) {
      forceNameOperationRef.current = {
        payloadKey: operationPayloadKey,
        operationId: crypto.randomUUID(),
      };
    }

    const response = await fetch("/api/admin/reports/actions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        operationId: forceNameOperationRef.current.operationId,
        action: "force_name_change",
        userId: profileTarget.id,
        reportIds: actionableReportIds,
        ...decisionResult.value,
      }),
    });

    const payload = await response.json().catch(() => ({}));

    setIsProcessing(false);

    if (!response.ok) {
      console.error("Failed to require name change:", payload?.error);
      toast.error(payload?.error ?? t.adminForceNameChangeError);
      return;
    }

    forceNameOperationRef.current = null;
    toast.success(t.adminForceNameChangeSuccess);
    router.push(returnHref);
    router.refresh();
  }

  async function handleSaveModeratorNotes() {
    if (!notesAvailable || !currentUserId || !report?.id || isSavingNotes || !hasNoteDraft) {
      return;
    }

    const noteResult = validateModeratorNoteEntry(moderatorNoteDraft);
    if (!noteResult.ok) {
      toast.error(t.adminModeratorNotesSaveError);
      return;
    }

    const operationPayloadKey = JSON.stringify({
      reportId: report.id,
      moderatorNote: noteResult.value,
    });
    if (notesOperationRef.current?.payloadKey !== operationPayloadKey) {
      notesOperationRef.current = {
        payloadKey: operationPayloadKey,
        operationId: crypto.randomUUID(),
      };
    }

    setIsSavingNotes(true);

    const response = await fetch("/api/admin/reports/actions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        action: "add_note",
        reportId: report.id,
        moderatorNote: noteResult.value,
        operationId: notesOperationRef.current.operationId,
      }),
    });

    const payload = await response.json().catch(() => ({}));

    setIsSavingNotes(false);

    if (!response.ok) {
      console.error("Failed to save moderator notes:", payload?.error);
      toast.error(t.adminModeratorNotesSaveError);
      return;
    }

    notesOperationRef.current = null;
    setModeratorNoteDraft("");
    toast.success(t.adminModeratorNotesSaved);
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-4">
      <Card className="rounded-2xl sm:rounded-[2rem] border-zinc-200 bg-white py-0 shadow-sm dark:bg-card dark:ring-border">
        <CardHeader className="border-b border-zinc-200 px-4 py-4 sm:px-6 sm:py-5 dark:border-border">
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
                  <Badge className="rounded-full bg-amber-100 px-2.5 py-0.5 text-amber-900 shadow-none dark:bg-amber-500/15 dark:text-amber-200">
                    {t.adminReportedMessageBadge}
                  </Badge>
                ) : null}
              </div>
              <h1 className="break-words text-2xl font-bold tracking-tight text-zinc-950 dark:text-foreground [overflow-wrap:anywhere]">
                {reviewTitle}
              </h1>
              <CardDescription className="hidden sm:block">{reviewDescription}</CardDescription>
            </div>
            <div className="text-right text-xs text-muted-foreground">
              <p>{t.reportedAt}</p>
              <ClientFormattedDateTime value={report.createdAt} language={language} />
            </div>
          </div>
        </CardHeader>

        <details className="min-w-0 border-t border-border"><summary className="min-h-11 cursor-pointer px-4 py-3 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:px-6">{t.adminQueueContext}</summary>
        <CardContent className="grid gap-4 px-4 py-4 sm:px-6 sm:py-5 md:grid-cols-2 xl:grid-cols-6">
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
        </details>
      </Card>

      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1.45fr)_minmax(0,0.8fr)]">
        <div className="min-w-0 space-y-5 xl:space-y-6">
          {isMessageReport ? (
          <section className={REPORT_EVIDENCE_PANEL_CLASS}>
            <div className="border-b border-zinc-200 px-4 py-4 sm:px-6 dark:border-border">
              <p className="text-lg font-semibold text-zinc-950 dark:text-foreground">
                {t.adminConversationContextLabel}
              </p>
              <p className="mt-1 text-sm text-zinc-500 dark:text-muted-foreground">
                {conversation?.contextLimited ? t.adminReportContextLimited : t.adminConversationContextDescription}
              </p>
              {conversation?.canReadFullConversation ? <Button asChild variant="outline" className="mt-3 min-h-11 whitespace-normal"><Link href={`/admin/conversations/${conversation.id}`}>{t.adminReportFullConversation}</Link></Button> : null}
            </div>

            <div className="min-h-0 flex-1 space-y-5 overflow-y-auto bg-zinc-50/70 px-4 py-4 sm:px-6 sm:py-5 dark:bg-muted/20">
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
                            <Badge className="rounded-full bg-amber-100 px-2 py-0 text-amber-900 shadow-none dark:bg-amber-500/15 dark:text-amber-200">
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

          </section>
          ) : isProfileReport ? (
          <section className={REPORT_EVIDENCE_PANEL_CLASS}>
            <div className="border-b border-zinc-200 px-4 py-4 sm:px-6 sm:py-5 dark:border-border">
              <p className="text-lg font-semibold text-zinc-950 dark:text-foreground">
                {reviewTitle}
              </p>
              <p className="mt-1 text-sm text-zinc-500 dark:text-muted-foreground">
                {reviewDescription}
              </p>
            </div>

            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto bg-zinc-50/70 px-4 py-4 sm:px-6 sm:py-5 dark:bg-muted/20">
              <Card className="rounded-[1.75rem] border-zinc-200 bg-white py-0 shadow-none dark:bg-card dark:ring-border">
                <CardHeader className="border-b border-zinc-200 px-4 py-4 sm:px-6 sm:py-5 dark:border-border">
                  <CardTitle className="break-words text-2xl text-zinc-950 dark:text-foreground [overflow-wrap:anywhere]">
                    {t.adminReportedProfileTitle}
                  </CardTitle>
                </CardHeader>
                <CardContent className="px-4 py-4 sm:px-6 sm:py-6">
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
                <CardHeader className="border-b border-zinc-200 px-4 py-4 sm:px-6 sm:py-5 dark:border-border">
                  <CardTitle className="break-words text-2xl text-zinc-950 dark:text-foreground [overflow-wrap:anywhere]">
                    {t.profileDescriptionTitle}
                  </CardTitle>
                </CardHeader>
                <CardContent className="px-4 py-4 sm:px-6 sm:py-6">
                  <p className="whitespace-pre-line text-sm leading-6 text-zinc-600 dark:text-muted-foreground">
                    {profileTarget?.bio || t.profileNoBio}
                  </p>
                </CardContent>
              </Card>

            </div>

          </section>
          ) : (
          <section className={REPORT_EVIDENCE_PANEL_CLASS}>
            <div className="border-b border-zinc-200 px-4 py-4 sm:px-6 sm:py-5 dark:border-border">
              <p className="text-lg font-semibold text-zinc-950 dark:text-foreground">
                {t.adminListingReviewTitle}
              </p>
              <p className="mt-1 text-sm text-zinc-500 dark:text-muted-foreground">
                {t.adminListingReviewDescription}
              </p>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto bg-zinc-50/70 px-4 py-4 sm:px-6 sm:py-5 dark:bg-muted/20">
              <div className="space-y-5">
                <div className="rounded-[1.75rem] border border-zinc-200 bg-white p-5 dark:border-border dark:bg-card">
                  <div className="flex items-start gap-4">
                    <ListingReviewImages images={listingReview?.listing?.images} imageUrl={listingReview?.listing?.imageUrl} title={listingReview?.listing?.title} />
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
                    <CardHeader className="border-b border-zinc-200 px-4 py-4 sm:px-6 sm:py-5 dark:border-border">
                      <CardTitle className="break-words text-2xl text-zinc-950 dark:text-foreground [overflow-wrap:anywhere]">
                        {t.description}
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="px-4 py-4 sm:px-6 sm:py-6">
                      <ListingDescriptionContent description={listingReview.listing.description} className="whitespace-normal leading-6 text-sm" />
                    </CardContent>
                  </Card>
                ) : null}
              </div>
            </div>
          </section>
          )}

          <ModeratorNotesCard
            t={t}
            language={language}
            notesAvailable={notesAvailable}
            moderatorNoteDraft={moderatorNoteDraft}
            setModeratorNoteDraft={setModeratorNoteDraft}
            moderatorNoteHistory={moderatorNoteHistory}
            moderatorNoteHistoryNextHref={moderatorNoteHistoryNextHref}
            isSavingNotes={isSavingNotes}
            hasNoteDraft={hasNoteDraft}
            handleSaveModeratorNotes={handleSaveModeratorNotes}
          />
        </div>

        <details className="min-w-0 rounded-2xl border border-border bg-card">
          <summary className="min-h-11 cursor-pointer p-4 font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{t.adminGroupedReports} · {t.adminQueueContext}</summary>
          <div className="min-w-0 space-y-4 border-t border-border p-3">

          <Card className="rounded-2xl sm:rounded-[2rem] border-zinc-200 bg-white py-0 shadow-sm dark:bg-card dark:ring-border">
            <CardHeader className="border-b border-zinc-200 px-4 py-4 sm:px-7 sm:py-6 dark:border-border">
              <CardTitle className="text-xl text-zinc-950 dark:text-foreground">
                {t.adminRelatedReportsTitle}
              </CardTitle>
              <CardDescription>{t.adminRelatedReportsDescription}</CardDescription>
            </CardHeader>
            <CardContent className="flex min-h-44 flex-col justify-center gap-4 px-4 py-4 sm:px-7 sm:py-6">
              {sortedRelatedReports.length > 0 ? (
                sortedRelatedReports.map((relatedReport) => {
                  const isCurrentReport = relatedReport.id === report.id;

                  return (
                    <Link
                      key={relatedReport.id}
                      href={`/admin/reports/${relatedReport.id}`}
                      className={`flex min-h-32 items-center rounded-2xl border p-5 transition ${
                        isCurrentReport
                          ? "border-primary/40 bg-primary/5"
                          : "border-zinc-200 bg-zinc-50 hover:bg-background dark:border-border dark:bg-muted/40 dark:hover:bg-background"
                      }`}
                    >
                      <div className="flex w-full flex-wrap items-center justify-between gap-3">
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
            <Card className="rounded-2xl sm:rounded-[2rem] border-zinc-200 bg-white py-0 shadow-sm dark:bg-card dark:ring-border">
              <CardHeader className="border-b border-zinc-200 px-4 py-4 sm:px-7 sm:py-6 dark:border-border">
                <CardTitle className="text-xl text-zinc-950 dark:text-foreground">
                  {t.adminReportedProfileTitle}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-5 px-4 py-4 sm:px-7 sm:py-6">
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
              <Card className="rounded-2xl sm:rounded-[2rem] border-zinc-200 bg-white py-0 shadow-sm dark:bg-card dark:ring-border">
                <CardHeader className="border-b border-zinc-200 px-4 py-4 sm:px-7 sm:py-6 dark:border-border">
                  <CardTitle className="text-xl text-zinc-950 dark:text-foreground">
                    {t.aboutListing}
                  </CardTitle>
                </CardHeader>
                <CardContent className="flex min-h-44 items-center px-4 py-4 sm:px-7 sm:py-6">
                  <Link href={`/listings/${listingTarget.slug}`} className="w-full rounded-2xl bg-zinc-50 p-5 transition hover:bg-background dark:bg-muted/40 dark:hover:bg-background">
                    <div className="flex min-h-24 items-center gap-4">
                      <div className="relative h-18 w-18 shrink-0 overflow-hidden rounded-2xl bg-zinc-100 dark:bg-muted">
                        {listingTarget?.imageUrl ? (
                          <Image
                            src={listingTarget.imageUrl}
                            alt={listingTarget.title}
                            fill
                            sizes="72px"
                            placeholder="blur"
                            blurDataURL={REMOTE_IMAGE_BLUR_DATA_URL}
                            className="object-cover"
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

              <Card className="rounded-2xl sm:rounded-[2rem] border-zinc-200 bg-white py-0 shadow-sm dark:bg-card dark:ring-border">
                <CardHeader className="border-b border-zinc-200 px-4 py-4 sm:px-7 sm:py-6 dark:border-border">
                  <CardTitle className="text-xl text-zinc-950 dark:text-foreground">
                    {isMessageReport ? t.adminParticipantsTitle : t.seller}
                  </CardTitle>
                </CardHeader>
                <CardContent className="flex min-h-52 flex-col justify-center gap-0 px-4 py-4 sm:px-7 sm:py-6">
                  {(isMessageReport ? [conversation.buyer, conversation.seller] : [listingReview?.seller])
                    .filter(Boolean)
                    .map((participant, index) => (
                      <React.Fragment key={participant.id}>
                        {index > 0 ? <Separator /> : null}
                        <Link href={`/profile/${participant.id}`} className="flex min-h-20 items-center gap-3 rounded-xl transition hover:bg-zinc-50/80 dark:hover:bg-muted/40">
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
        </details>
      </div>

      {canDecide && hasOpenRelatedReports ? (
        <Card className="rounded-2xl sm:rounded-[2rem] border-zinc-200 bg-white py-0 shadow-sm dark:bg-card dark:ring-border">
          <CardHeader className="border-b border-zinc-200 px-4 py-4 sm:px-6 sm:py-5 dark:border-border sm:px-7 sm:py-6">
            <CardTitle className="text-lg text-zinc-950 dark:text-foreground">
              {t.adminReportDecisionDetailsTitle}
            </CardTitle>
            <CardDescription>{t.adminDecisionPrivateFieldsNotice}</CardDescription>
          </CardHeader>
          <CardContent className={`grid items-start gap-x-6 gap-y-7 px-4 py-4 sm:px-6 sm:py-6 sm:px-7 sm:py-7 ${
            canRemoveListing || canForceNameChange ? "lg:grid-cols-2" : "lg:grid-cols-1"
          }`}>
            <DecisionTextField
              id="report-decision-summary"
              label={t.adminReportDecisionSummaryLabel}
              description={t.adminReportDecisionSummaryDescription}
              value={decisionSummary}
              onChange={(event) => {
                setDecisionSummary(event.target.value);
                setFieldErrors((current) => ({ ...current, decisionSummary: "" }));
              }}
              textareaRef={decisionSummaryRef}
              limit={REPORT_DECISION_SUMMARY_MAX_LENGTH}
              error={fieldErrors.decisionSummary}
              required
            />

            {canRemoveListing ? (
              <>
                <DecisionTextField
                  id="reported-listing-seller-feedback"
                  label={t.adminRemoveListingFeedbackLabel}
                  description={t.adminRemoveListingFeedbackDescription}
                  value={sellerFeedback}
                  onChange={(event) => {
                    setSellerFeedback(event.target.value);
                    setFieldErrors((current) => ({ ...current, sellerFeedback: "" }));
                  }}
                  textareaRef={sellerFeedbackRef}
                  limit={REPORTED_LISTING_FEEDBACK_MAX_LENGTH}
                  error={fieldErrors.sellerFeedback}
                  required
                />
                <DecisionTextField
                  id="reported-listing-private-summary"
                  label={t.adminRemoveListingPrivateSummaryLabel}
                  description={t.adminRemoveListingPrivateSummaryDescription}
                  value={removalPrivateSummary}
                  onChange={(event) => {
                    setRemovalPrivateSummary(event.target.value);
                    setFieldErrors((current) => ({ ...current, removalPrivateSummary: "" }));
                  }}
                  textareaRef={removalPrivateSummaryRef}
                  limit={REPORTED_LISTING_PRIVATE_SUMMARY_MAX_LENGTH}
                  error={fieldErrors.removalPrivateSummary}
                />
              </>
            ) : null}

            {canForceNameChange ? (
              <>
                <DecisionTextField
                  id="force-name-policy-reason"
                  label={t.adminForceNamePolicyReasonLabel}
                  description={t.adminForceNamePolicyReasonDescription}
                  value={forcePolicyReason}
                  onChange={(event) => {
                    setForcePolicyReason(event.target.value);
                    setFieldErrors((current) => ({ ...current, forcePolicyReason: "" }));
                  }}
                  textareaRef={forcePolicyReasonRef}
                  limit={FORCE_NAME_POLICY_REASON_MAX_LENGTH}
                  error={fieldErrors.forcePolicyReason}
                  required
                />
                <DecisionTextField
                  id="force-name-user-message"
                  label={t.adminForceNameUserMessageLabel}
                  description={t.adminForceNameUserMessageDescription}
                  value={forceUserMessage}
                  onChange={(event) => {
                    setForceUserMessage(event.target.value);
                    setFieldErrors((current) => ({ ...current, forceUserMessage: "" }));
                  }}
                  textareaRef={forceUserMessageRef}
                  limit={FORCE_NAME_USER_MESSAGE_MAX_LENGTH}
                  error={fieldErrors.forceUserMessage}
                  required
                />
                <DecisionTextField
                  id="force-name-private-note"
                  label={t.adminForceNamePrivateNoteLabel}
                  description={t.adminForceNamePrivateNoteDescription}
                  value={forcePrivateNote}
                  onChange={(event) => {
                    setForcePrivateNote(event.target.value);
                    setFieldErrors((current) => ({ ...current, forcePrivateNote: "" }));
                  }}
                  textareaRef={forcePrivateNoteRef}
                  limit={MODERATOR_NOTE_MAX_LENGTH}
                  error={fieldErrors.forcePrivateNote}
                />
              </>
            ) : null}
          </CardContent>
          <CardFooter className="border-zinc-200 bg-muted/20 px-4 py-4 sm:px-6 sm:py-5 dark:border-border sm:px-7 sm:py-6">
            <ReportDecisionActions
              t={t}
              canRemoveListing={canRemoveListing}
              canForceNameChange={canForceNameChange}
              isProcessing={isProcessing}
              hasOpenRelatedReports={hasOpenRelatedReports}
              removeListingActionLabel={removeListingActionLabel}
              dismissActionLabel={dismissActionLabel}
              resolveActionLabel={resolveActionLabel}
              handleRemoveListing={handleRemoveListing}
              handleForceNameChange={handleForceNameChange}
              handleUpdateStatus={handleUpdateStatus}
            />
          </CardFooter>
        </Card>
      ) : null}
    </div>
  );
}
