import {
  MESSAGE_NOTIFICATION_ROW_TYPES,
  MESSAGE_NOTIFICATION_TYPE,
  NOTIFICATION_PREFERENCE_TYPES,
  NOTIFICATION_WITH_MESSAGE_SELECT,
  buildNotificationPreferencesMap,
  getEnabledNotificationRowTypes,
  isMessageNotificationType,
  isNotificationPreferencesTableMissing,
} from "./notifications.js";
import { subscribeToNotificationUpdates } from "./notification-realtime.mjs";

function emptySnapshot() {
  return {
    preferences: buildNotificationPreferencesMap(),
    unreadCount: 0,
    unreadMessageCount: 0,
    hasUnreadMessages: false,
    rows: [],
    previewLoaded: false,
    previewError: false,
    isLoading: false,
  };
}

// One instance belongs to one mounted account. It never persists private data.
export function createNotificationFeed({ supabase, userId, onError = console.error }) {
  let snapshot = emptySnapshot();
  const listeners = new Set();
  let active = false;
  let generation = 0;
  let revision = 0;
  let inFlight = null;
  let pendingRefresh = false;
  let pendingMutations = 0;
  let refreshTimer = null;
  let previewConsumers = 0;
  let removeRealtime = () => {};
  let removeAuth = () => {};

  function publish(patch) {
    snapshot = { ...snapshot, ...patch };
    listeners.forEach((listener) => listener());
  }

  async function load(includePreview, isCurrent) {
    const preferenceResult = await supabase
      .from("notification_preferences")
      .select("notification_type, email_enabled, in_app_enabled")
      .eq("user_id", userId)
      .in("notification_type", NOTIFICATION_PREFERENCE_TYPES);

    if (!isCurrent()) return {};
    if (preferenceResult.error && !isNotificationPreferencesTableMissing(preferenceResult.error)) {
      throw preferenceResult.error;
    }

    const preferences = buildNotificationPreferencesMap(preferenceResult.data ?? []);
    const enabledTypes = getEnabledNotificationRowTypes(preferences);
    const countQuery = (types) => supabase
      .from("notifications")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .in("type", types)
      .is("read_at", null);
    const [unread, messages, preview] = await Promise.all([
      countQuery(enabledTypes).is("dismissed_at", null),
      preferences[MESSAGE_NOTIFICATION_TYPE].inApp
        ? countQuery(MESSAGE_NOTIFICATION_ROW_TYPES)
        : { count: 0 },
      includePreview
        ? supabase
            .from("notifications")
            .select(NOTIFICATION_WITH_MESSAGE_SELECT)
            .eq("user_id", userId)
            .in("type", enabledTypes)
            .is("dismissed_at", null)
            .is("read_at", null)
            .order("created_at", { ascending: false })
            .limit(24)
        : null,
    ]);

    const patch = { preferences };
    if (unread.error) onError("Failed to load unread notification count:", unread.error);
    else patch.unreadCount = unread.count ?? 0;
    if (messages.error) onError("Failed to load unread message count:", messages.error);
    else {
      patch.unreadMessageCount = messages.count ?? 0;
      patch.hasUnreadMessages = patch.unreadMessageCount > 0;
    }
    if (preview) {
      patch.previewLoaded = true;
      patch.previewError = Boolean(preview.error);
      if (preview.error) onError("Failed to load notifications:", preview.error);
      else patch.rows = preview.data ?? [];
    }
    return patch;
  }

  function refresh({ invalidate = false } = {}) {
    if (!active) return Promise.resolve();
    if (pendingMutations > 0) {
      pendingRefresh = true;
      return inFlight ?? Promise.resolve();
    }
    if (inFlight) {
      pendingRefresh ||= invalidate;
      return inFlight;
    }

    clearTimeout(refreshTimer);
    refreshTimer = null;
    const requestGeneration = generation;
    const isCurrent = () => active && generation === requestGeneration;
    inFlight = (async () => {
      do {
        pendingRefresh = false;
        const requestRevision = revision;
        const includePreview = previewConsumers > 0;
        if (includePreview && !snapshot.previewLoaded) publish({ isLoading: true });
        try {
          const patch = await load(includePreview, isCurrent);
          if (isCurrent() && revision === requestRevision) publish(patch);
        } catch (error) {
          if (isCurrent() && revision === requestRevision) {
            onError("Failed to refresh notifications:", error);
            if (includePreview) publish({ previewLoaded: true, previewError: true });
          }
        }
      } while (isCurrent() && pendingRefresh && pendingMutations === 0);
    })().finally(() => {
      if (isCurrent()) {
        inFlight = null;
        // An invalidation can arrive after the loop exits but before this callback.
        if (pendingRefresh && pendingMutations === 0) return refresh();
        publish({ isLoading: false });
      }
    });
    return inFlight;
  }

  function invalidate() {
    if (!active) return;
    revision += 1;
    if (inFlight) {
      pendingRefresh = true;
    } else if (refreshTimer === null) {
      refreshTimer = setTimeout(() => {
        refreshTimer = null;
        void refresh();
      }, 50);
    }
  }

  async function mutate(write, onSuccess) {
    if (!active) return { error: new Error("Notification account is no longer active.") };
    const mutationGeneration = generation;
    const isCurrent = () => active && generation === mutationGeneration;
    // Hold the count snapshot until the write's confirmed delta is applied. A
    // Realtime refresh must not publish that delta first and subtract it twice.
    pendingMutations += 1;
    invalidate();
    try {
      const result = await (typeof write === "function" ? write() : write);
      if (isCurrent() && !result.error) onSuccess(result);
      return result;
    } finally {
      if (isCurrent()) {
        pendingMutations -= 1;
        invalidate();
      }
    }
  }

  function stop() {
    active = false;
    generation += 1;
    inFlight = null;
    pendingRefresh = false;
    pendingMutations = 0;
    clearTimeout(refreshTimer);
    refreshTimer = null;
    removeRealtime();
    removeAuth();
    removeRealtime = () => {};
    removeAuth = () => {};
    publish(emptySnapshot());
  }

  return {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    start() {
      if (!userId || active) return stop;
      active = true;
      removeRealtime = subscribeToNotificationUpdates({
        supabase,
        userId,
        channelName: `notification-feed-${userId}`,
        onChange: invalidate,
      });
      const { data } = supabase.auth.onAuthStateChange((_event, session) => {
        if (session?.user?.id !== userId) stop();
      });
      removeAuth = () => data.subscription.unsubscribe();
      void refresh();
      return stop;
    },
    retainPreview() {
      previewConsumers += 1;
      void refresh({ invalidate: true });
      return () => { previewConsumers -= 1; };
    },
    removeNotification(notification, write, { markRead = false } = {}) {
      return mutate(write, ({ data }) => {
        const enabledTypes = getEnabledNotificationRowTypes(snapshot.preferences);
        // DELETE returns the original lifecycle fields, including rows beyond
        // the bounded preview. UPDATE callers target unread, undismissed rows.
        const affectedRows = data ?? [];
        let removedUnread = 0;
        let removedMessages = 0;
        for (const row of affectedRows) {
          if (!markRead && row.read_at !== null) continue;
          if ((markRead || row.dismissed_at === null) && enabledTypes.includes(row.type)) {
            removedUnread += 1;
          }
          if (snapshot.preferences[MESSAGE_NOTIFICATION_TYPE].inApp && isMessageNotificationType(row.type)) {
            removedMessages += 1;
          }
        }
        const unreadMessageCount = Math.max(0, snapshot.unreadMessageCount - removedMessages);
        publish({
          rows: snapshot.rows.filter((row) => (
            notification.conversationId && isMessageNotificationType(notification.type)
              ? row.conversation_id !== notification.conversationId || !isMessageNotificationType(row.type)
              : row.id !== notification.id
          )),
          unreadCount: Math.max(0, snapshot.unreadCount - removedUnread),
          unreadMessageCount,
          hasUnreadMessages: unreadMessageCount > 0,
        });
      });
    },
    markAllRead(write) {
      return mutate(write, () => {
        publish({ rows: [], unreadCount: 0, unreadMessageCount: 0, hasUnreadMessages: false });
      });
    },
    refresh,
    invalidate,
  };
}
