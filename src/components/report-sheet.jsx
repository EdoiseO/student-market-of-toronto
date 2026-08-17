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
import { validateReportDetails } from "@/lib/write-field-contracts.mjs";
import { createClient } from "@/utils/supabase/client";

export function ReportSheet({
  open,
  onOpenChange,
  subjectType,
  subjectId,
  currentUserId,
}) {
  const { t } = useLanguage();
  const supabase = React.useMemo(() => createClient(), []);
  const [details, setDetails] = React.useState("");
  const [selectedReason, setSelectedReason] = React.useState("");
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [detailsError, setDetailsError] = React.useState("");
  const detailsRef = React.useRef(null);
  const operationRef = React.useRef(null);

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
  const isOtherReason = selectedReason === "other";

  React.useEffect(() => {
    if (!open) {
      return;
    }

    setSelectedReason(reasonOptions[0]?.value ?? "");
    setDetails("");
    setDetailsError("");
    operationRef.current = null;
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

    const detailsResult = validateReportDetails(details, {
      isOther: isOtherReason,
    });

    if (!detailsResult.ok) {
      setDetailsError(t.reportOtherDetailsRequired);
      detailsRef.current?.focus();
      return;
    }

    setDetailsError("");

    const operationPayloadKey = JSON.stringify({
      subjectType,
      subjectId,
      reason: selectedReason,
      details: detailsResult.value,
    });
    if (operationRef.current?.payloadKey !== operationPayloadKey) {
      operationRef.current = {
        payloadKey: operationPayloadKey,
        operationId: crypto.randomUUID(),
      };
    }

    setIsSubmitting(true);

    const { error } = await supabase.rpc("submit_marketplace_report", {
      p_subject_type: subjectType,
      p_subject_id: subjectId,
      p_reason: selectedReason,
      p_details: detailsResult.value,
      p_operation_id: operationRef.current.operationId,
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

    operationRef.current = null;
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
                    onChange={(event) => {
                      setSelectedReason(event.target.value);
                      setDetailsError("");
                    }}
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
                    <FieldTitle className="text-foreground">
                      {t.reportDetailsLabel}
                      {isOtherReason ? (
                        <span className="ml-1 text-xs font-medium text-destructive">
                          ({t.requiredFieldLabel})
                        </span>
                      ) : null}
                    </FieldTitle>
                    <FieldDescription id="report-details-description">
                      {isOtherReason
                        ? t.reportOtherDetailsDescription
                        : t.reportDetailsDescription}
                    </FieldDescription>
                  </FieldContent>
                  <div className="rounded-lg border border-zinc-200 bg-background p-3 shadow-sm dark:border-border dark:bg-background">
                    <FieldLabel htmlFor="report-details" className="sr-only">
                      {t.reportDetailsLabel}
                    </FieldLabel>
                    <Textarea
                      ref={detailsRef}
                      id="report-details"
                      value={details}
                      onChange={(event) => {
                        setDetails(event.target.value);
                        if (detailsError) {
                          setDetailsError("");
                        }
                      }}
                      placeholder={detailsPlaceholder}
                      rows={2}
                      className="h-20 min-h-20 max-h-48 resize-y border-0 bg-transparent px-2 py-2 shadow-none focus-visible:ring-0"
                      required={isOtherReason}
                      aria-required={isOtherReason}
                      aria-invalid={Boolean(detailsError)}
                      aria-describedby={`report-details-description report-details-count${detailsError ? " report-details-error" : ""}`}
                    />
                  </div>
                  <div className="flex items-start justify-between gap-3 text-xs">
                    <p
                      id="report-details-error"
                      role={detailsError ? "alert" : undefined}
                      className="min-h-4 text-destructive"
                    >
                      {detailsError}
                    </p>
                    <p id="report-details-count" className="shrink-0 text-muted-foreground">
                      {t.reportDetailsCharacterCount.replace(
                        "{count}",
                        String(Array.from(details).length),
                      )}
                    </p>
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
