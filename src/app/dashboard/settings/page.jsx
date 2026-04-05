import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { DashboardSettingsContent } from "@/components/dashboard-settings-content";
import {
  MESSAGE_NOTIFICATION_TYPE,
  isNotificationPreferencesTableMissing,
  normalizeMessageNotificationPreferences,
} from "@/lib/notifications";
import { createClient } from "@/utils/supabase/server";

export default async function DashboardSettingsPage() {
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: existingProfile, error: profileError } = await supabase
    .from("profiles")
    .select("bio, is_public")
    .eq("id", user.id)
    .maybeSingle();

  if (profileError) {
    console.error("Failed to load dashboard settings profile:", profileError.message);
  }

  const { data: messageNotificationPreferencesRow, error: messageNotificationPreferencesError } =
    await supabase
      .from("notification_preferences")
      .select("email_enabled, in_app_enabled")
      .eq("user_id", user.id)
      .eq("notification_type", MESSAGE_NOTIFICATION_TYPE)
      .maybeSingle();

  const messageNotificationPreferencesAvailable = !messageNotificationPreferencesError;

  if (
    messageNotificationPreferencesError &&
    !isNotificationPreferencesTableMissing(messageNotificationPreferencesError)
  ) {
    console.error(
      "Failed to load message notification preferences:",
      messageNotificationPreferencesError.message,
    );
  }

  return (
    <main className="min-h-screen bg-zinc-100 p-6 dark:bg-background md:p-8">
      <div className="mx-auto flex w-full max-w-[1280px] flex-col gap-8">
        <DashboardSettingsContent
          userEmail={user.email ?? ""}
          userId={user.id}
          initialHideBioOnListingPage={Boolean(existingProfile?.is_public)}
          hasBio={Boolean(existingProfile?.bio?.trim())}
          initialMessageNotificationPreferences={normalizeMessageNotificationPreferences(
            messageNotificationPreferencesRow,
          )}
          messageNotificationPreferencesAvailable={messageNotificationPreferencesAvailable}
        />
      </div>
    </main>
  );
}
