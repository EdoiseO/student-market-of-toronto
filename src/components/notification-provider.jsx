"use client";

import * as React from "react";
import { createNotificationFeed } from "@/lib/notification-feed.mjs";
import { createClient } from "@/utils/supabase/client";

const NotificationContext = React.createContext(null);

export function NotificationProvider({ userId, children }) {
  const feed = React.useMemo(
    () => createNotificationFeed({ supabase: createClient(), userId }),
    [userId],
  );
  React.useEffect(() => feed.start(), [feed]);

  return (
    <NotificationContext.Provider value={feed}>
      {children}
    </NotificationContext.Provider>
  );
}

export function useNotifications() {
  const feed = React.useContext(NotificationContext);
  if (!feed) throw new Error("Notifications require NotificationProvider.");
  const snapshot = React.useSyncExternalStore(feed.subscribe, feed.getSnapshot, feed.getSnapshot);
  return { ...snapshot, feed };
}
