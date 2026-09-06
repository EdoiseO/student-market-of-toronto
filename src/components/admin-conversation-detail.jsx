"use client";

import * as React from "react";
import {
  ArrowLeft,
  CalendarClock,
  CheckCircle2,
  Clock3,
  ExternalLink,
  Flag,
  LockKeyhole,
  MessageSquareText,
  RotateCcw,
  ShieldAlert,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { MessageMediaGallery } from "@/components/message-media-gallery";
import { ProfileAvatar } from "@/components/profile-avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import {
  ADMIN_CONVERSATION_DURATIONS,
  ADMIN_CONVERSATION_REASON_CODES,
} from "@/lib/admin-conversations.mjs";
import { cn } from "@/lib/utils";

function formatDate(value, language) {
  if (!value) {
    return "—";
  }

  return new Intl.DateTimeFormat(language === "fr" ? "fr-CA" : "en-CA", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function getPersonName(person, fallback) {
  return [person?.firstName, person?.lastName].filter(Boolean).join(" ").trim() || fallback;
}

function getReasonLabel(reasonCode, t) {
  return {
    spam: t.reportReasonSpam,
    scam: t.reportReasonScam,
    harassment: t.reportReasonHarassment,
    inappropriate: t.reportReasonInappropriate,
    prohibited: t.reportReasonProhibited,
    other: t.reportReasonOther,
  }[reasonCode] ?? reasonCode;
}

function getDurationLabel(duration, t) {
  return {
    "24h": t.adminConversationDuration24h,
    "7d": t.adminConversationDuration7d,
    "30d": t.adminConversationDuration30d,
    permanent: t.adminConversationDurationPermanent,
  }[duration];
}

function ParticipantCard({ person, label, t }) {
  const name = getPersonName(person, t.student);

  return (
    <div className="flex min-w-0 items-center gap-3 rounded-2xl border border-border bg-background p-3.5">
      <ProfileAvatar
        name={name}
        avatarPresetId={person?.avatarPresetId}
        avatarUrl={person?.avatarUrl}
        className="size-11 shrink-0"
        imageSizes="44px"
      />
      <div className="min-w-0">
        <p className="text-[0.68rem] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
          {label}
        </p>
        <p className="truncate text-sm font-semibold text-foreground">{name}</p>
        <p className="truncate text-xs text-muted-foreground">{person?.school || t.torontoStudent}</p>
      </div>
    </div>
  );
}

function ConversationActionSheet({
  action,
  open,
  onOpenChange,
  conversationId,
  expectedVersion,
  language,
  reports,
  role,
  t,
}) {
  const router = useRouter();
  const isClose = action === "close";
  const availableDurations =
    role === "admin"
      ? ADMIN_CONVERSATION_DURATIONS
      : ADMIN_CONVERSATION_DURATIONS.filter((duration) => duration !== "permanent");
  const [reasonCode, setReasonCode] = React.useState("harassment");
  const [userMessage, setUserMessage] = React.useState("");
  const [internalNote, setInternalNote] = React.useState("");
  const [duration, setDuration] = React.useState(isClose ? "24h" : "");
  const [sourceReportId, setSourceReportId] = React.useState("");
  const [resolveSourceReport, setResolveSourceReport] = React.useState(false);
  const [operationId, setOperationId] = React.useState("");
  const [isSubmitting, setIsSubmitting] = React.useState(false);

  React.useEffect(() => {
    if (!open) {
      return;
    }

    setReasonCode("harassment");
    setUserMessage("");
    setInternalNote("");
    setDuration(isClose ? "24h" : "");
    setSourceReportId("");
    setResolveSourceReport(false);
    setOperationId(crypto.randomUUID());
  }, [isClose, open]);

  function updateIntent(setter, value) {
    setter(value);
    setOperationId(crypto.randomUUID());
  }

  async function handleSubmit(event) {
    event.preventDefault();

    if (isSubmitting || !operationId) {
      return;
    }

    setIsSubmitting(true);

    try {
      const response = await fetch(`/api/admin/conversations/${conversationId}/moderation`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          expectedVersion,
          reasonCode,
          userMessage,
          internalNote,
          duration,
          sourceReportId: sourceReportId || null,
          resolveSourceReport,
          operationId,
        }),
      });
      await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(t.adminConversationActionError);
      }

      toast.success(
        isClose ? t.adminConversationClosedSuccess : t.adminConversationReopenedSuccess,
      );
      onOpenChange(false);
      router.refresh();
    } catch (error) {
      toast.error(error.message || t.adminConversationActionError);
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full gap-0 overflow-y-auto sm:max-w-lg">
        <SheetHeader className="border-b border-border px-5 py-5 pr-14 sm:px-6">
          <SheetTitle className="text-xl font-semibold">
            {isClose ? t.adminConversationCloseTitle : t.adminConversationReopenTitle}
          </SheetTitle>
          <SheetDescription className="leading-6">
            {isClose
              ? t.adminConversationCloseDescription
              : t.adminConversationReopenDescription}
          </SheetDescription>
        </SheetHeader>

        <form onSubmit={handleSubmit} className="flex min-h-full flex-col">
          <div className="space-y-5 px-5 py-5 sm:px-6">
            <label className="block space-y-2">
              <span className="text-sm font-medium text-foreground">
                {t.adminConversationReasonLabel}
              </span>
              <NativeSelect
                value={reasonCode}
                onChange={(event) => updateIntent(setReasonCode, event.target.value)}
                className="w-full"
                required
              >
                {ADMIN_CONVERSATION_REASON_CODES.map((reason) => (
                  <NativeSelectOption key={reason} value={reason}>
                    {getReasonLabel(reason, t)}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </label>

            {isClose ? (
              <label className="block space-y-2">
                <span className="text-sm font-medium text-foreground">
                  {t.adminConversationDurationLabel}
                </span>
                <NativeSelect
                  value={duration}
                  onChange={(event) => updateIntent(setDuration, event.target.value)}
                  className="w-full"
                  required
                >
                  {availableDurations.map((durationValue) => (
                    <NativeSelectOption key={durationValue} value={durationValue}>
                      {getDurationLabel(durationValue, t)}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
                {role !== "admin" ? (
                  <span className="block text-xs leading-5 text-muted-foreground">
                    {t.adminConversationModeratorDurationHint}
                  </span>
                ) : null}
              </label>
            ) : null}

            <label className="block space-y-2">
              <span className="text-sm font-medium text-foreground">
                {t.adminConversationUserMessageLabel}
              </span>
              <Textarea
                value={userMessage}
                onChange={(event) => updateIntent(setUserMessage, event.target.value)}
                minLength={10}
                maxLength={1000}
                rows={4}
                required
                placeholder={t.adminConversationUserMessagePlaceholder}
                className="min-h-28 resize-y"
              />
              <span className="block text-xs leading-5 text-muted-foreground">
                {t.adminConversationUserMessageHint}
              </span>
            </label>

            <label className="block space-y-2">
              <span className="text-sm font-medium text-foreground">
                {t.adminConversationInternalNoteLabel}
              </span>
              <Textarea
                value={internalNote}
                onChange={(event) => updateIntent(setInternalNote, event.target.value)}
                maxLength={2000}
                rows={3}
                placeholder={t.adminConversationInternalNotePlaceholder}
                className="min-h-24 resize-y"
              />
            </label>

            <label className="block space-y-2">
              <span className="text-sm font-medium text-foreground">
                {t.adminConversationLinkedReportLabel}
              </span>
              <NativeSelect
                value={sourceReportId}
                onChange={(event) => {
                  updateIntent(setSourceReportId, event.target.value);
                  setResolveSourceReport(false);
                }}
                className="w-full"
              >
                <NativeSelectOption value="">
                  {t.adminConversationNoLinkedReport}
                </NativeSelectOption>
                {reports.map((report) => (
                  <NativeSelectOption key={report.id} value={report.id}>
                    {getReasonLabel(report.reason, t)} · {formatDate(report.created_at, language)}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </label>

            <label
              className={cn(
                "flex items-start gap-3 rounded-2xl border border-border bg-muted/20 p-4",
                !sourceReportId && "opacity-60",
              )}
            >
              <input
                type="checkbox"
                checked={resolveSourceReport}
                onChange={(event) => updateIntent(setResolveSourceReport, event.target.checked)}
                disabled={!sourceReportId}
                className="mt-0.5 size-4 rounded border-input accent-foreground"
              />
              <span className="min-w-0">
                <span className="block text-sm font-medium text-foreground">
                  {t.adminConversationResolveReportLabel}
                </span>
                <span className="mt-1 block text-xs leading-5 text-muted-foreground">
                  {t.adminConversationResolveReportDescription}
                </span>
              </span>
            </label>

            <div className="rounded-2xl border border-blue-200 bg-blue-50 p-4 text-sm leading-6 text-blue-950 dark:border-blue-950 dark:bg-blue-950/35 dark:text-blue-100">
              {t.adminConversationParticipantNotificationHint}
            </div>
          </div>

          <SheetFooter className="sticky bottom-0 mt-auto border-t border-border bg-background px-5 py-4 sm:flex-row sm:justify-end sm:px-6">
            <Button
              type="button"
              variant="outline"
              className="h-11 rounded-xl"
              onClick={() => onOpenChange(false)}
              disabled={isSubmitting}
            >
              {t.cancel}
            </Button>
            <Button
              type="submit"
              variant={isClose ? "destructive" : "default"}
              className="h-11 rounded-xl"
              disabled={isSubmitting || userMessage.trim().length < 10}
            >
              {isSubmitting
                ? t.saving
                : isClose
                  ? t.adminConversationCloseAction
                  : t.adminConversationReopenAction}
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}

export function AdminConversationDetail({
  detail,
  messages,
  hasOlderMessages,
  olderMessagesHref,
  returnHref = "/admin/conversations",
  role,
  language,
  t,
}) {
  const [action, setAction] = React.useState(null);
  const state = detail.moderationState;
  const isClosed = state.effectiveStatus === "closed";
  const openReports = (detail.reports ?? []).filter((report) => report.status === "open");

  return (
    <main className="min-h-screen bg-zinc-100 px-4 py-4 dark:bg-background sm:px-5 md:p-6 lg:p-7">
      <div className="mx-auto flex w-full max-w-[1360px] flex-col gap-4">
        <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
          <Button asChild variant="ghost" className="min-h-11 rounded-full px-3">
            <Link href={returnHref}>
              <ArrowLeft className="size-4" />
              {t.adminConversationsBackAction}
            </Link>
          </Button>
          <Badge variant="outline" className="rounded-full px-3 py-1.5">
            <ShieldAlert className="mr-1.5 size-3.5" />
            {t.adminConversationReviewBadge}
          </Badge>
        </div>

        <header className="overflow-hidden rounded-[1.75rem] border border-border bg-card shadow-sm md:rounded-[2rem]">
          <div className="flex min-w-0 flex-col gap-4 px-4 py-5 sm:px-5 md:flex-row md:items-start md:justify-between md:px-7 md:py-6">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <Badge
                  variant="outline"
                  className={cn(
                    "rounded-full",
                    isClosed
                      ? "border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950/50 dark:text-amber-200"
                      : "border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/50 dark:text-emerald-200",
                  )}
                >
                  {isClosed ? t.adminConversationsClosedStatus : t.adminConversationsOpenStatus}
                </Badge>
                {openReports.length > 0 ? (
                  <Badge variant="destructive" className="rounded-full">
                    <Flag className="mr-1 size-3" />
                    {openReports.length}
                  </Badge>
                ) : null}
              </div>
              <h1 className="mt-3 break-words text-2xl font-bold tracking-tight text-foreground md:text-3xl">
                {detail.listing?.title || t.listing}
              </h1>
              <p className="mt-1 break-all text-xs text-muted-foreground sm:text-sm">
                {detail.conversationId}
              </p>
            </div>

            <div className="flex w-full flex-col gap-2 sm:flex-row md:w-auto">
              {isClosed ? (
                <Button className="h-11 rounded-xl" onClick={() => setAction("reopen")}>
                  <RotateCcw className="size-4" />
                  {t.adminConversationReopenAction}
                </Button>
              ) : (
                <Button
                  variant="destructive"
                  className="h-11 rounded-xl"
                  onClick={() => setAction("close")}
                >
                  <LockKeyhole className="size-4" />
                  {t.adminConversationCloseAction}
                </Button>
              )}
              {detail.listing?.slug ? (
                <Button asChild variant="outline" className="h-11 rounded-xl">
                  <Link href={`/listings/${detail.listing.slug}`}>
                    <ExternalLink className="size-4" />
                    {t.adminConversationViewListing}
                  </Link>
                </Button>
              ) : null}
            </div>
          </div>

          <details className="min-w-0 border-t border-border"><summary className="min-h-11 cursor-pointer p-4 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{t.adminQueueContext}</summary>
          <div className="grid gap-3 border-t border-border bg-muted/15 p-4 sm:grid-cols-2 sm:p-5 lg:grid-cols-4 lg:px-7">
            <ParticipantCard person={detail.buyer} label={t.adminConversationBuyerLabel} t={t} />
            <ParticipantCard person={detail.seller} label={t.adminConversationSellerLabel} t={t} />
            <div className="rounded-2xl border border-border bg-background p-3.5">
              <p className="text-[0.68rem] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                {t.adminConversationsLastActivity}
              </p>
              <p className="mt-2 text-sm font-medium text-foreground">
                {formatDate(detail.lastMessageAt || detail.updatedAt, language)}
              </p>
            </div>
            <div className="rounded-2xl border border-border bg-background p-3.5">
              <p className="text-[0.68rem] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                {t.adminConversationStateVersionLabel}
              </p>
              <p className="mt-2 text-sm font-medium text-foreground">#{state.version}</p>
              {isClosed ? (
                <p className="mt-1 text-xs text-muted-foreground">
                  {state.closedUntil
                    ? formatDate(state.closedUntil, language)
                    : t.adminConversationDurationPermanent}
                </p>
              ) : null}
            </div>
          </div>
          </details>
        </header>

        <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1.5fr)_minmax(320px,0.7fr)]">
          <section className="min-w-0 overflow-hidden rounded-[1.75rem] border border-border bg-card shadow-sm md:rounded-[2rem]">
            <div className="border-b border-border px-4 py-4 sm:px-5 md:px-6">
              <h2 className="flex items-center gap-2 text-lg font-semibold text-foreground">
                <MessageSquareText className="size-5" />
                {t.adminConversationTranscriptTitle}
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                {t.adminConversationTranscriptDescription}
              </p>
            </div>

            <div className="min-w-0 space-y-3 bg-muted/10 p-3 sm:p-4 md:p-5">
              {hasOlderMessages && olderMessagesHref ? (
                <div className="text-center">
                  <Button asChild variant="outline" size="sm" className="rounded-full">
                    <Link href={olderMessagesHref}>{t.adminConversationOlderMessages}</Link>
                  </Button>
                </div>
              ) : null}

              {messages.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-border px-4 py-10 text-center text-sm text-muted-foreground">
                  {t.adminConversationTranscriptEmpty}
                </div>
              ) : (
                messages.map((message) => {
                  const senderName = message.sender.name || t.student;

                  return (
                    <article
                      key={message.id}
                      className={cn(
                        "min-w-0 rounded-2xl border bg-background p-3 sm:p-4",
                        message.reportCount > 0
                          ? "border-red-300 ring-1 ring-red-100 dark:border-red-900 dark:ring-red-950"
                          : "border-border",
                      )}
                    >
                      <div className="flex min-w-0 items-start gap-3">
                        <ProfileAvatar
                          name={senderName}
                          avatarPresetId={message.sender.avatarPresetId}
                          avatarUrl={message.sender.avatarUrl}
                          className="size-9 shrink-0"
                          imageSizes="36px"
                        />
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <p className="truncate text-sm font-semibold text-foreground">
                              {senderName}
                            </p>
                            <div className="flex items-center gap-2">
                              {message.reportCount > 0 ? (
                                <Badge variant="destructive" className="rounded-full text-[0.68rem]">
                                  <Flag className="mr-1 size-3" />
                                  {message.reportCount}
                                </Badge>
                              ) : null}
                              <time className="text-xs text-muted-foreground">
                                {formatDate(message.createdAt, language)}
                              </time>
                            </div>
                          </div>
                          {message.attachments.length > 0 ? (
                            <div className="mt-3 max-w-xl overflow-hidden rounded-xl">
                              <MessageMediaGallery attachments={message.attachments} />
                            </div>
                          ) : null}
                          {message.body ? (
                            <p className="mt-3 whitespace-pre-wrap break-words text-sm leading-6 text-foreground">
                              {message.body}
                            </p>
                          ) : null}
                          {message.reactions.length > 0 ? (
                            <div className="mt-3 flex flex-wrap gap-1.5" aria-label={t.messageReactions}>
                              {message.reactions.map((reaction, index) => (
                                <span
                                  key={`${reaction.user_id}-${reaction.emoji}-${index}`}
                                  className="rounded-full border border-border bg-muted/30 px-2 py-1 text-xs"
                                >
                                  {reaction.emoji}
                                </span>
                              ))}
                            </div>
                          ) : null}
                        </div>
                      </div>
                    </article>
                  );
                })
              )}
            </div>
          </section>

          <aside className="min-w-0 space-y-4">
            {isClosed ? (
              <section className="rounded-[1.75rem] border border-amber-300 bg-amber-50 p-4 text-amber-950 shadow-sm dark:border-amber-900 dark:bg-amber-950/35 dark:text-amber-100 md:p-5">
                <h2 className="flex items-center gap-2 font-semibold">
                  <LockKeyhole className="size-4" />
                  {t.adminConversationCurrentRestrictionTitle}
                </h2>
                <p className="mt-2 text-sm leading-6">{state.userMessage}</p>
                <dl className="mt-3 grid gap-2 text-xs">
                  <div className="flex items-center justify-between gap-3">
                    <dt>{t.adminConversationReasonLabel}</dt>
                    <dd className="font-medium">{getReasonLabel(state.reasonCode, t)}</dd>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <dt>{t.conversationClosedUntilLabel}</dt>
                    <dd className="text-right font-medium">
                      {state.closedUntil
                        ? formatDate(state.closedUntil, language)
                        : t.conversationClosedIndefinitely}
                    </dd>
                  </div>
                </dl>
              </section>
            ) : null}

            <section className="overflow-hidden rounded-[1.75rem] border border-border bg-card shadow-sm">
              <div className="border-b border-border px-4 py-4 md:px-5">
                <h2 className="flex items-center gap-2 font-semibold text-foreground">
                  <Flag className="size-4" />
                  {t.adminConversationLinkedReportsTitle}
                </h2>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">
                  {t.adminConversationLinkedReportsDescription}
                </p>
              </div>
              <div className="space-y-2 p-3 md:p-4">
                {(detail.reports ?? []).length === 0 ? (
                  <p className="rounded-xl border border-dashed border-border px-3 py-6 text-center text-sm text-muted-foreground">
                    {t.adminConversationLinkedReportsEmpty}
                  </p>
                ) : (
                  detail.reports.map((report) => (
                    <Link
                      key={report.id}
                      href={`/admin/reports/${report.id}`}
                      className="block min-w-0 rounded-xl border border-border bg-background p-3 transition-colors hover:bg-muted/25"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate text-sm font-medium text-foreground">
                          {getReasonLabel(report.reason, t)}
                        </span>
                        <Badge variant="outline" className="shrink-0 rounded-full text-[0.68rem]">
                          {report.status === "open" ? t.adminOpenStatus : t.adminResolvedStatus}
                        </Badge>
                      </div>
                      <p className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">
                        {report.details || t.adminConversationNoReportDetails}
                      </p>
                      <p className="mt-2 text-[0.68rem] text-muted-foreground">
                        {formatDate(report.created_at, language)}
                      </p>
                    </Link>
                  ))
                )}
              </div>
            </section>

            <section className="overflow-hidden rounded-[1.75rem] border border-border bg-card shadow-sm">
              <div className="border-b border-border px-4 py-4 md:px-5">
                <h2 className="flex items-center gap-2 font-semibold text-foreground">
                  <CalendarClock className="size-4" />
                  {t.adminConversationHistoryTitle}
                </h2>
              </div>
              <div className="space-y-3 p-4">
                {(detail.history ?? []).length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    {t.adminConversationHistoryEmpty}
                  </p>
                ) : (
                  detail.history.map((event) => (
                    <div key={event.id} className="flex gap-3">
                      <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
                        {event.action === "close" ? (
                          <LockKeyhole className="size-3.5" />
                        ) : (
                          <CheckCircle2 className="size-3.5" />
                        )}
                      </span>
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-foreground">
                          {event.action === "close"
                            ? t.adminConversationHistoryClosed
                            : t.adminConversationHistoryReopened}
                        </p>
                        <p className="mt-0.5 break-words text-xs leading-5 text-muted-foreground">
                          {event.user_message}
                        </p>
                        <p className="mt-1 inline-flex items-center gap-1 text-[0.68rem] text-muted-foreground">
                          <Clock3 className="size-3" />
                          {formatDate(event.created_at, language)}
                        </p>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </section>
          </aside>
        </div>
      </div>

      <ConversationActionSheet
        action={action ?? "close"}
        open={action !== null}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) {
            setAction(null);
          }
        }}
        conversationId={detail.conversationId}
        expectedVersion={state.version}
        language={language}
        reports={openReports}
        role={role}
        t={t}
      />
    </main>
  );
}
