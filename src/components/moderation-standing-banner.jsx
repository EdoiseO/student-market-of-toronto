"use client";

import * as React from "react";
import Link from "next/link";
import { ShieldAlert } from "lucide-react";
import { usePathname } from "next/navigation";

import { Button } from "@/components/ui/button";
import { useLanguage } from "@/context/LanguageContext";
import {
  ENFORCEMENT_NOTIFICATION_ROW_TYPES,
  isEnforcementNotificationType,
  subscribeToNotificationUpdates,
} from "@/lib/notifications";
import { createClient } from "@/utils/supabase/client";

const IMPORTANT_NOTICE_SEVERITIES = ["high", "critical"];

export function ModerationStandingBanner({ user }) {
  const pathname = usePathname() ?? "";
  const { t } = useLanguage();
  const supabase = React.useMemo(() => createClient(), []);
  const [notice, setNotice] = React.useState(null);

  const fetchImportantNotice = React.useCallback(async () => {
    if (!user?.id) {
      setNotice(null);
      return;
    }

    const { data, error } = await supabase
      .from("user_moderation_notices")
      .select(
        "id, sanction_type, severity, lifecycle_state, acknowledgement_required, acknowledged_at, created_at",
      )
      .in("severity", IMPORTANT_NOTICE_SEVERITIES)
      .eq("lifecycle_state", "active")
      .eq("acknowledgement_required", true)
      .is("acknowledged_at", null)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      console.error("Failed to load important account-standing notice:", error.message);
      return;
    }

    setNotice(data ?? null);
  }, [supabase, user?.id]);

  React.useEffect(() => {
    fetchImportantNotice();
  }, [fetchImportantNotice, pathname]);

  React.useEffect(() => {
    if (!user?.id) {
      return undefined;
    }

    return subscribeToNotificationUpdates({
      supabase,
      userId: user.id,
      channelName: `moderation-standing-banner-${user.id}`,
      notificationPreferenceTypes: ENFORCEMENT_NOTIFICATION_ROW_TYPES,
      onChange: (payload) => {
        const notificationType = payload.new?.type ?? payload.old?.type;

        if (!notificationType || isEnforcementNotificationType(notificationType)) {
          fetchImportantNotice();
        }
      },
    });
  }, [fetchImportantNotice, supabase, user?.id]);

  if (!user || !notice || pathname === "/dashboard/standing") {
    return null;
  }

  return (
    <aside
      role="status"
      aria-live="polite"
      className="mx-3 mt-3 grid min-w-0 gap-3 rounded-2xl border border-amber-300/80 bg-amber-50 p-3 text-amber-950 shadow-sm dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-50 sm:mx-4 sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:items-center sm:p-4"
    >
      <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-amber-200/70 text-amber-900 dark:bg-amber-400/15 dark:text-amber-200">
        <ShieldAlert className="size-4" aria-hidden="true" />
      </span>
      <div className="min-w-0">
        <p className="break-words text-sm font-semibold leading-5">
          {t.moderationStandingBannerTitle}
        </p>
        <p className="mt-0.5 break-words text-xs leading-5 text-amber-800 dark:text-amber-100/80 sm:text-sm">
          {t.moderationStandingBannerDescription}
        </p>
      </div>
      <Button
        asChild
        variant="outline"
        size="sm"
        className="h-11 w-full min-w-0 justify-center whitespace-normal rounded-xl border-amber-300 bg-white px-3 text-center text-amber-950 hover:bg-amber-100 sm:w-auto sm:shrink-0 dark:border-amber-500/40 dark:bg-background dark:text-amber-50 dark:hover:bg-amber-500/10"
      >
        <Link href="/dashboard/standing">{t.moderationStandingBannerAction}</Link>
      </Button>
    </aside>
  );
}
