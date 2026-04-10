"use client";

import * as React from "react";
import { Flag } from "lucide-react";

import { ReportSheet } from "@/components/report-sheet";
import { Button } from "@/components/ui/button";
import { useLanguage } from "@/context/LanguageContext";
import { REPORT_SUBJECT_TYPES } from "@/lib/moderation";

export function ProfileReportButton({ profileId, currentUserId = null }) {
  const { t } = useLanguage();
  const [open, setOpen] = React.useState(false);

  if (!profileId || !currentUserId || profileId === currentUserId) {
    return null;
  }

  return (
    <>
      <Button type="button" variant="outline" className="w-full rounded-xl sm:w-auto" onClick={() => setOpen(true)}>
        <Flag className="size-4" />
        <span>{t.reportProfile}</span>
      </Button>

      <ReportSheet
        open={open}
        onOpenChange={setOpen}
        subjectType={REPORT_SUBJECT_TYPES.profile}
        subjectId={profileId}
        currentUserId={currentUserId}
        reportedUserId={profileId}
      />
    </>
  );
}
