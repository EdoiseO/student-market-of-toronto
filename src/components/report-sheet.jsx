"use client";

import * as React from "react";
import Link from "next/link";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldTitle,
} from "@/components/ui/field";
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
import { useLanguage } from "@/context/LanguageContext";
import {
  REPORT_SUBJECT_TYPES,
  getReportReasonOptions,
  isReportsTableMissing,
  isReportsSubjectTypeUnsupported,
} from "@/lib/moderation";
import { createClient } from "@/utils/supabase/client";

export function ReportSheet({
  open,
  onOpenChange,
  subjectType,
  subjectId,
  currentUserId,
  reportedUserId = null,
  listingId = null,
  messageId = null,
  conversationId = null,
}) {
  const { t } = useLanguage();
  const supabase = React.useMemo(() => createClient(), []);
  const [details, setDetails] = React.useState("");
  const [selectedReason, setSelectedReason] = React.useState("");
  const [isSubmitting, setIsSubmitting] = React.useState(false);

  const reasonOptions = React.useMemo(
    () => getReportReasonOptions(subjectType, t),
    [subjectType, t],
  );
  const sheetTitle =
    subjectType === REPORT_SUBJECT_TYPES.message
      ? t.reportMessageTitle
      : subjectType === REPORT_SUBJECT_TYPES.profile
        ? t.reportProfileTitle
        : t.reportListingTitle;
  const sheetDescription =
    subjectType === REPORT_SUBJECT_TYPES.message
      ? t.reportMessageDescription
      : subjectType === REPORT_SUBJECT_TYPES.profile
        ? t.reportProfileDescription
        : t.reportListingDescription;
  const reasonDescription =
    subjectType === REPORT_SUBJECT_TYPES.profile
      ? t.reportProfileReasonDescription
      : t.reportReasonDescription;
  const detailsPlaceholder =
    subjectType === REPORT_SUBJECT_TYPES.profile
      ? t.reportProfileDetailsPlaceholder
      : t.reportDetailsPlaceholder;

  React.useEffect(() => {
    if (!open) {
      return;
    }

    setSelectedReason(reasonOptions[0]?.value ?? "");
    setDetails("");
  }, [open, reasonOptions]);

  async function handleSubmit(event) {
    event.preventDefault();

    if (!currentUserId) {
      toast.error(t.reportRequiresLogin);
      return;
    }

    if (!subjectId || !selectedReason || isSubmitting) {
      return;
    }

    if (reportedUserId && reportedUserId === currentUserId) {
      toast.error(t.reportSelfUnavailable);
      return;
    }

    setIsSubmitting(true);

    const { error } = await supabase.from("reports").insert({
      reporter_user_id: currentUserId,
      subject_type: subjectType,
      subject_id: subjectId,
      listing_id: listingId,
      message_id: messageId,
      conversation_id: conversationId,
      reported_user_id: reportedUserId,
      reason: selectedReason,
      details: details.trim() || null,
      status: "open",
    });

    setIsSubmitting(false);

    if (error) {
      const isModerationUnavailable =
        isReportsTableMissing(error) || isReportsSubjectTypeUnsupported(error);

      if (!isModerationUnavailable) {
        console.error("Failed to submit report:", error.message);
      }

      toast.error(isModerationUnavailable ? t.reportModerationUnavailable : t.reportSubmitError);
      return;
    }

    toast.success(t.reportSubmitted);
    onOpenChange(false);
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-md">
        <SheetHeader className="border-b border-border px-6 py-5">
          <SheetTitle>{sheetTitle}</SheetTitle>
          <SheetDescription>{sheetDescription}</SheetDescription>
        </SheetHeader>

        {!currentUserId ? (
          <div className="space-y-4 px-6 py-6">
            <p className="text-sm text-muted-foreground">{t.reportRequiresLogin}</p>
            <Button asChild className="rounded-xl">
              <Link href="/login" onClick={() => onOpenChange(false)}>
                {t.login}
              </Link>
            </Button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="flex h-full flex-col">
            <div className="space-y-5 px-6 py-6">
              <FieldGroup>
                <Field orientation="vertical" className="items-stretch gap-2">
                  <FieldContent>
                    <FieldTitle className="text-foreground">{t.reportReasonLabel}</FieldTitle>
                    <FieldDescription>{reasonDescription}</FieldDescription>
                  </FieldContent>
                  <FieldLabel htmlFor="report-reason" className="sr-only">
                    {t.reportReasonLabel}
                  </FieldLabel>
                  <NativeSelect
                    id="report-reason"
                    value={selectedReason}
                    onChange={(event) => setSelectedReason(event.target.value)}
                    className="w-full"
                    required
                  >
                    {reasonOptions.map((option) => (
                      <NativeSelectOption key={option.value} value={option.value}>
                        {option.label}
                      </NativeSelectOption>
                    ))}
                  </NativeSelect>
                </Field>

                <Field orientation="vertical" className="items-stretch gap-2">
                  <FieldContent>
                    <FieldTitle className="text-foreground">{t.reportDetailsLabel}</FieldTitle>
                    <FieldDescription>{t.reportDetailsDescription}</FieldDescription>
                  </FieldContent>
                  <div className="rounded-lg border border-zinc-200 bg-background p-3 shadow-sm dark:border-border dark:bg-background">
                    <Textarea
                      value={details}
                      onChange={(event) => setDetails(event.target.value)}
                      placeholder={detailsPlaceholder}
                      rows={2}
                      className="min-h-16 resize-none border-0 bg-transparent px-2 py-2 shadow-none focus-visible:ring-0"
                      maxLength={600}
                    />
                  </div>
                </Field>
              </FieldGroup>
            </div>

            <SheetFooter className="border-t border-border px-6 py-5 sm:flex-row sm:justify-end">
              <Button
                type="button"
                variant="outline"
                className="rounded-xl"
                onClick={() => onOpenChange(false)}
                disabled={isSubmitting}
              >
                {t.cancel}
              </Button>
              <Button type="submit" className="rounded-xl" disabled={isSubmitting || !selectedReason}>
                {isSubmitting ? t.reportSubmitting : t.reportSubmit}
              </Button>
            </SheetFooter>
          </form>
        )}
      </SheetContent>
    </Sheet>
  );
}
