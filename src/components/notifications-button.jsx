"use client";

import * as React from "react";
import { Popover } from "@base-ui/react/popover";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Bell, X } from "lucide-react";
import { toast } from "sonner";

import { ClientFormattedDateTime } from "@/components/client-formatted-date-time";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useLanguage } from "@/context/LanguageContext";
import {
  MESSAGE_NOTIFICATION_ROW_TYPES,
  NOTIFICATION_WITH_MESSAGE_SELECT,
  buildNotificationPreferencesMap,
  getEnabledNotificationRowTypes,
  groupNotificationsByConversation,
  isNotificationPreferencesTableMissing,
  isMessageNotificationType,
  normalizeGroupedNotificationRow,
  subscribeToNotificationUpdates,
  NOTIFICATION_PREFERENCE_TYPES,
} from "@/lib/notifications";
import { createClient } from "@/utils/supabase/client";

export function NotificationsButton({ user }) {
  const router = useRouter();
  const supabase = React.useMemo(() => createClient(), []);
  const { t, language } = useLanguage();
  const [isOpen, setIsOpen] = React.useState(false);
  const [isLoading, setIsLoading] = React.useState(false);
  const [isMarkingAllRead, setIsMarkingAllRead] = React.useState(false);
  const [dismissingNotificationKey, setDismissingNotificationKey] = React.useState(null);
  const [notifications, setNotifications] = React.useState([]);
  const [unreadCount, setUnreadCount] = React.useState(0);
  const [notificationPreferences, setNotificationPreferences] = React.useState(
    buildNotificationPreferencesMap(),
  );
  const headerActionButtonClassName = "rounded-lg px-2 text-xs";

  const hasAnyInAppNotificationsEnabled = Object.values(notificationPreferences).some(
    (preferences) => preferences.inApp,
  );

  const fetchNotifications = React.useCallback(async () => {
    if (!user?.id) {
      return;
    }

    setIsLoading(true);

    const { data: notificationPreferenceRows, error: notificationPreferencesError } =
      await supabase
        .from("notification_preferences")
        .select("notification_type, email_enabled, in_app_enabled")
        .eq("user_id", user.id)
        .in("notification_type", NOTIFICATION_PREFERENCE_TYPES);

    if (
      notificationPreferencesError &&
      !isNotificationPreferencesTableMissing(notificationPreferencesError)
    ) {
      console.error("Failed to load notification preferences:", notificationPreferencesError.message);
    }

    const normalizedNotificationPreferences = buildNotificationPreferencesMap(
      notificationPreferenceRows,
    );
    const enabledNotificationRowTypes = getEnabledNotificationRowTypes(
      normalizedNotificationPreferences,
    );

    setNotificationPreferences(normalizedNotificationPreferences);

    if (enabledNotificationRowTypes.length === 0) {
      setNotifications([]);
      setUnreadCount(0);
      setIsLoading(false);
      return;
    }

    const [notificationsResult, unreadCountResult] = await Promise.all([
      supabase
        .from("notifications")
        .select(NOTIFICATION_WITH_MESSAGE_SELECT)
        .eq("user_id", user.id)
        .in("type", enabledNotificationRowTypes)
        .is("read_at", null)
        .order("created_at", { ascending: false })
        .limit(24),
      supabase
        .from("notifications")
        .select("id", { count: "exact", head: true })
        .eq("user_id", user.id)
        .in("type", enabledNotificationRowTypes)
        .is("read_at", null),
    ]);

    if (notificationsResult.error) {
      console.error("Failed to load notifications:", notificationsResult.error.message);
      setIsLoading(false);
      return;
    }

    if (unreadCountResult.error) {
      console.error("Failed to load unread notifications count:", unreadCountResult.error.message);
    }

    const normalizedNotifications = groupNotificationsByConversation(
      (notificationsResult.data ?? []).map((notification) =>
        normalizeGroupedNotificationRow(notification, user.id, t, language),
      ),
    ).slice(0, 8);

    setNotifications(normalizedNotifications);
    setUnreadCount(unreadCountResult.count ?? 0);
    setIsLoading(false);
  }, [language, supabase, t, user]);

  React.useEffect(() => {
    fetchNotifications();
  }, [fetchNotifications]);

  React.useEffect(() => {
    if (isOpen) {
      fetchNotifications();
    }
  }, [fetchNotifications, isOpen]);

  React.useEffect(() => {
    if (!user?.id) {
      return undefined;
    }

    return subscribeToNotificationUpdates({
      supabase,
      userId: user.id,
      channelName: `notifications-button-${user.id}`,
      onChange: () => {
        fetchNotifications();
      },
    });
  }, [fetchNotifications, supabase, user?.id]);

  function removeNotificationFromState(notification) {
    setNotifications((currentNotifications) =>
      currentNotifications.filter(
        (currentNotification) => currentNotification.groupKey !== notification.groupKey,
      ),
    );
    setUnreadCount((currentUnreadCount) =>
      Math.max(0, currentUnreadCount - notification.unreadCount),
    );
  }

  async function deleteNotificationGroup(notification) {
    if (!notification || dismissingNotificationKey === notification.groupKey) {
      return false;
    }

    setDismissingNotificationKey(notification.groupKey);

    let query = supabase.from("notifications").delete();

    query = notification.conversationId && isMessageNotificationType(notification.type)
      ? query
          .eq("user_id", user.id)
          .in("type", MESSAGE_NOTIFICATION_ROW_TYPES)
          .eq("conversation_id", notification.conversationId)
      : query.eq("user_id", user.id).eq("id", notification.id);

    const { error } = await query;

    setDismissingNotificationKey(null);

    if (error) {
      console.error("Failed to dismiss notification:", error.message);
      toast.error(t.notificationDismissError);
      return false;
    }

    removeNotificationFromState(notification);
    return true;
  }

  async function handleNotificationClick(event, notification) {
    event.preventDefault();

    if (!notification) {
      return;
    }

    await deleteNotificationGroup(notification);
    setIsOpen(false);
    router.push(notification.href);
  }

  async function handleDismissNotification(event, notification) {
    event.preventDefault();
    event.stopPropagation();

    await deleteNotificationGroup(notification);
  }

  async function handleMarkAllRead() {
    if (!unreadCount || isMarkingAllRead) {
      return;
    }

    setIsMarkingAllRead(true);

    const readAt = new Date().toISOString();
    const enabledNotificationRowTypes = getEnabledNotificationRowTypes(notificationPreferences);

    if (enabledNotificationRowTypes.length === 0) {
      setIsMarkingAllRead(false);
      return;
    }

    const { error } = await supabase
      .from("notifications")
      .update({ read_at: readAt })
      .eq("user_id", user.id)
      .in("type", enabledNotificationRowTypes)
      .is("read_at", null);

    setIsMarkingAllRead(false);

    if (error) {
      console.error("Failed to mark all notifications read:", error.message);
      return;
    }

    setNotifications((currentNotifications) =>
      currentNotifications.map((notification) => ({
        ...notification,
        readAt: notification.readAt ?? readAt,
      })),
    );
    setUnreadCount(0);
  }

  if (!user) {
    return null;
  }

  return (
    <Popover.Root open={isOpen} onOpenChange={(open) => setIsOpen(open)}>
      <Popover.Trigger
        aria-label={t.notificationsButtonLabel}
        render={<Button type="button" variant="outline" size="icon" />}
        className="relative h-10 w-10 rounded-xl"
      >
        <Bell className="size-4" />
        {unreadCount > 0 ? (
          <Badge className="absolute -top-1.5 -right-1.5 rounded-full bg-blue-500 px-1.5 py-0 text-[0.65rem] leading-5 text-white ring-2 ring-background shadow-[0_0_12px_rgba(59,130,246,0.95)]">
            {unreadCount > 9 ? "9+" : unreadCount}
          </Badge>
        ) : null}
      </Popover.Trigger>

      <Popover.Portal>
        <Popover.Positioner align="end" sideOffset={8} className="z-[80]">
          <Popover.Popup className="z-[80] w-80 rounded-2xl border border-border bg-popover p-2 text-popover-foreground shadow-md outline-none">
        <div className="flex items-center justify-between gap-3 px-2 py-1.5">
          <p className="truncate text-sm font-semibold text-foreground">{t.notifications}</p>
          {hasAnyInAppNotificationsEnabled && unreadCount > 0 ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className={headerActionButtonClassName}
              onClick={handleMarkAllRead}
              disabled={isMarkingAllRead}
            >
              {t.notificationsMarkAllRead}
            </Button>
          ) : null}
        </div>
        <div className="my-1 h-px bg-border" />

        {!hasAnyInAppNotificationsEnabled ? (
          <div className="px-3 py-8 text-center">
            <p className="text-sm font-medium text-foreground">
              {t.notificationsDisabledTitle}
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              {t.notificationsDisabledDescription}
            </p>
            <Button asChild variant="outline" size="sm" className="mt-4 rounded-xl">
              <Link href="/dashboard/settings">{t.settings}</Link>
            </Button>
          </div>
        ) : isLoading ? (
          <div className="px-3 py-6 text-sm text-muted-foreground">
            {t.loadingNotifications}
          </div>
        ) : notifications.length > 0 ? (
          notifications.map((notification) => (
            <div
              key={notification.groupKey}
              className={`relative rounded-xl ${
                notification.readAt ? "opacity-80" : "bg-muted/30"
              }`}
            >
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                aria-label={t.dismissNotification}
                className="absolute top-2 right-2 z-10 rounded-full text-muted-foreground hover:text-foreground"
                onClick={(event) => handleDismissNotification(event, notification)}
                disabled={dismissingNotificationKey === notification.groupKey}
              >
                <X className="size-3.5" />
              </Button>

              <Link
                href={notification.href}
                onClick={(event) => handleNotificationClick(event, notification)}
                className="block rounded-xl px-3 py-3 pr-10 transition hover:bg-muted/60"
              >
                <div className="min-w-0">
                  <div className="flex min-w-0 items-center gap-2">
                    <p className="truncate font-medium text-foreground">
                      {notification.title}
                    </p>
                    {notification.unreadCount > 1 ? (
                      <Badge variant="outline" className="shrink-0 rounded-full border-border bg-background px-2 py-0 text-[0.65rem] text-foreground">
                        {notification.unreadCount}
                      </Badge>
                    ) : null}
                    <ClientFormattedDateTime
                      value={notification.createdAt}
                      language={language}
                      className="ml-auto shrink-0 whitespace-nowrap text-xs text-muted-foreground"
                    />
                  </div>
                  <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">
                    {notification.description}
                  </p>
                </div>
              </Link>
            </div>
          ))
        ) : (
          <div className="px-3 py-8 text-center">
            <p className="text-sm font-medium text-foreground">
              {t.noNotificationsTitle}
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              {t.noNotificationsDescription}
            </p>
          </div>
        )}

        <div className="my-1 h-px bg-border" />
        <div className="flex justify-end px-2 py-1.5">
          <Button asChild variant="ghost" size="sm" className={headerActionButtonClassName}>
            <Link href="/messages" onClick={() => setIsOpen(false)}>
              {t.notificationsViewAll}
            </Link>
          </Button>
        </div>

          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
