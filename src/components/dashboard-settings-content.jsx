"use client";

import * as React from "react";
import { AlertTriangle, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { toast } from "sonner";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardTitle,
} from "@/components/ui/card";
import {
  FieldLabel,
  FieldTitle,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Switch } from "@/components/ui/switch";
import { useLanguage } from "@/context/LanguageContext";
import {
  FAVOURITE_NOTIFICATION_TYPE,
  MESSAGE_NOTIFICATION_TYPE,
  NOTIFICATION_PREFERENCE_TYPES,
  SOLD_NOTIFICATION_TYPE,
  defaultNotificationChannelPreferences,
} from "@/lib/notifications";
import { cn } from "@/lib/utils";
import { createClient } from "@/utils/supabase/client";

export function DashboardSettingsContent({
  userEmail,
  userId,
  deleteAccountAvailable,
  initialHideBioOnListingPage,
  hasBio,
  initialNotificationPreferences,
  notificationPreferencesAvailable,
}) {
  const { t } = useLanguage();
  const router = useRouter();
  const { theme, setTheme } = useTheme();
  const supabase = React.useMemo(() => createClient(), []);
  const [hideBioOnListingPage, setHideBioOnListingPage] = React.useState(
    initialHideBioOnListingPage,
  );
  const [savedHideBioOnListingPage, setSavedHideBioOnListingPage] = React.useState(
    initialHideBioOnListingPage,
  );
  const [isSavingBioVisibility, setIsSavingBioVisibility] = React.useState(false);
  const [themePreference, setThemePreference] = React.useState("system");
  const [notificationPreferences, setNotificationPreferences] = React.useState(
    initialNotificationPreferences,
  );
  const [savedNotificationPreferences, setSavedNotificationPreferences] = React.useState(
    initialNotificationPreferences,
  );
  const [isSavingNotificationPreferences, setIsSavingNotificationPreferences] =
    React.useState(false);
  const [confirmationEmail, setConfirmationEmail] = React.useState("");
  const [isDeletingAccount, setIsDeletingAccount] = React.useState(false);
  const emailMatches = confirmationEmail.trim().toLowerCase() === userEmail.trim().toLowerCase();

  React.useEffect(() => {
    setHideBioOnListingPage(initialHideBioOnListingPage);
    setSavedHideBioOnListingPage(initialHideBioOnListingPage);
  }, [initialHideBioOnListingPage]);

  React.useEffect(() => {
    if (theme === "light" || theme === "dark" || theme === "system") {
      setThemePreference(theme);
    }
  }, [theme]);

  React.useEffect(() => {
    setNotificationPreferences(initialNotificationPreferences);
    setSavedNotificationPreferences(initialNotificationPreferences);
  }, [initialNotificationPreferences]);

  const hasBioVisibilityChanges = hideBioOnListingPage !== savedHideBioOnListingPage;
  const hasNotificationPreferenceChanges = NOTIFICATION_PREFERENCE_TYPES.some(
    (notificationType) =>
      notificationPreferences[notificationType]?.email !==
        savedNotificationPreferences[notificationType]?.email ||
      notificationPreferences[notificationType]?.inApp !==
        savedNotificationPreferences[notificationType]?.inApp,
  );

  const appearanceOptions = [
    {
      value: "light",
      title: t.settingsThemeLight,
    },
    {
      value: "dark",
      title: t.settingsThemeDark,
    },
    {
      value: "system",
      title: t.settingsThemeSystem,
    },
  ];

  const notificationPreferenceItems = [
    {
      key: SOLD_NOTIFICATION_TYPE,
      title: t.settingsSoldNotificationsTitle,
      description: t.settingsSoldNotificationsDescription,
      isLive: notificationPreferencesAvailable,
      channelPreferences:
        notificationPreferences[SOLD_NOTIFICATION_TYPE] ?? defaultNotificationChannelPreferences,
    },
    {
      key: FAVOURITE_NOTIFICATION_TYPE,
      title: t.settingsFavouriteNotificationsTitle,
      description: t.settingsFavouriteNotificationsDescription,
      isLive: notificationPreferencesAvailable,
      channelPreferences:
        notificationPreferences[FAVOURITE_NOTIFICATION_TYPE] ??
        defaultNotificationChannelPreferences,
    },
    {
      key: MESSAGE_NOTIFICATION_TYPE,
      title: t.settingsMessagesNotificationsTitle,
      description: t.settingsMessagesNotificationsDescription,
      isLive: notificationPreferencesAvailable,
      channelPreferences:
        notificationPreferences[MESSAGE_NOTIFICATION_TYPE] ?? defaultNotificationChannelPreferences,
    },
  ];
  async function handleBioVisibilitySave() {
    if (!hasBioVisibilityChanges || isSavingBioVisibility) {
      return;
    }

    setIsSavingBioVisibility(true);

    try {
      const { error } = await supabase
        .from("profiles")
        .upsert(
          {
            id: userId,
            is_public: hideBioOnListingPage,
          },
          { onConflict: "id" },
        );

      if (error) {
        throw error;
      }

      setSavedHideBioOnListingPage(hideBioOnListingPage);
      toast.success(t.settingsBioVisibilitySaved);
      router.refresh();
    } catch (error) {
      console.error("Failed to save bio visibility setting", error);
      toast.error(t.settingsBioVisibilityError);
    } finally {
      setIsSavingBioVisibility(false);
    }
  }

  async function handleNotificationPreferencesSave() {
    if (
      !notificationPreferencesAvailable ||
      !hasNotificationPreferenceChanges ||
      isSavingNotificationPreferences
    ) {
      return;
    }

    setIsSavingNotificationPreferences(true);

    try {
      const updatedAt = new Date().toISOString();
      const { error } = await supabase.from("notification_preferences").upsert(
        NOTIFICATION_PREFERENCE_TYPES.map((notificationType) => ({
          user_id: userId,
          notification_type: notificationType,
          email_enabled: notificationPreferences[notificationType]?.email ?? true,
          in_app_enabled: notificationPreferences[notificationType]?.inApp ?? true,
          updated_at: updatedAt,
        })),
        { onConflict: "user_id,notification_type" },
      );

      if (error) {
        throw error;
      }

      setSavedNotificationPreferences(notificationPreferences);
      toast.success(t.settingsNotificationPreferencesSaved);
      router.refresh();
    } catch (error) {
      console.error("Failed to save notification preferences", error);
      toast.error(t.settingsNotificationPreferencesError);
    } finally {
      setIsSavingNotificationPreferences(false);
    }
  }

  function handleNotificationChannelChange(notificationKey, channelKey, checked) {
    if (!notificationPreferencesAvailable) {
      return;
    }

    setNotificationPreferences((currentPreferences) => ({
      ...currentPreferences,
      [notificationKey]: {
        ...(currentPreferences[notificationKey] ?? defaultNotificationChannelPreferences),
        [channelKey]: checked === true,
      },
    }));
  }

  function handleThemePreferenceChange(value) {
    setThemePreference(value);
    setTheme(value);
    toast.success(t.settingsThemeSaved);
  }

  async function handleDeleteAccount() {
    if (!deleteAccountAvailable || isDeletingAccount || !emailMatches) {
      return;
    }

    setIsDeletingAccount(true);

    try {
      const response = await fetch("/api/account/delete", {
        method: "POST",
      });
      const payload = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(payload?.error || t.settingsDeleteAccountError);
      }

      await supabase.auth.signOut();
      toast.success(t.settingsDeleteAccountSuccess);
      router.push("/");
      router.refresh();
    } catch (error) {
      console.error("Failed to delete account", error);
      toast.error(error.message || t.settingsDeleteAccountError);
    } finally {
      setIsDeletingAccount(false);
      setConfirmationEmail("");
    }
  }

  return (
    <>
      <section className="rounded-2xl bg-card p-4 shadow-sm ring-1 ring-border md:rounded-3xl md:p-8">
        <h1 className="text-xl font-bold tracking-tight text-foreground md:text-4xl">
          {t.settings}
        </h1>
        <p className="mt-1 max-w-4xl text-xs leading-5 text-muted-foreground md:mt-3 md:text-base md:leading-6">
          {t.settingsDescription}
        </p>
      </section>

      <div className="flex flex-col gap-3 md:gap-4">
        <Card className="gap-0 rounded-2xl bg-card py-0 shadow-sm ring-border md:rounded-3xl">
          <section aria-labelledby="settings-appearance-title" className="border-b border-border px-4 py-3 md:px-6 md:py-5">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between lg:gap-6">
              <div className="min-w-0">
                <h2 id="settings-appearance-title" className="text-base font-semibold text-foreground md:text-lg">
                  {t.settingsAppearanceTitle}
                </h2>
                <p className="mt-0.5 text-xs leading-5 text-muted-foreground md:text-sm">
                  {t.settingsAppearanceDescription}
                </p>
              </div>

              <RadioGroup
                value={themePreference}
                onValueChange={handleThemePreferenceChange}
                aria-label={t.settingsThemePreference}
                className="grid w-full grid-cols-3 gap-1 rounded-xl bg-muted p-1 lg:w-[340px] lg:shrink-0"
              >
                {appearanceOptions.map((option) => (
                  <FieldLabel
                    key={option.value}
                    htmlFor={`theme-preview-${option.value}`}
                    className={cn(
                      "relative flex min-h-11 w-full min-w-0 items-center justify-center rounded-lg px-1.5 text-center transition-colors has-[:focus-visible]:ring-3 has-[:focus-visible]:ring-ring/50",
                      themePreference === option.value
                        ? "bg-background text-foreground shadow-sm ring-1 ring-border"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    <FieldTitle className="line-clamp-2 block min-w-0 text-[0.7rem] leading-tight md:text-sm">
                      {option.title}
                    </FieldTitle>
                    <RadioGroupItem value={option.value} id={`theme-preview-${option.value}`} className="sr-only" />
                  </FieldLabel>
                ))}
              </RadioGroup>
            </div>
          </section>

          <section aria-labelledby="settings-notifications-title">
            <div className="border-b border-border px-4 py-3 md:px-6 md:py-5">
              <h2 id="settings-notifications-title" className="text-base font-semibold text-foreground md:text-lg">
                {t.settingsNotificationsTitle}
              </h2>
              <p className="mt-0.5 text-xs leading-5 text-muted-foreground md:text-sm">
                {t.settingsNotificationsDescription}
              </p>
            </div>

            <div className="divide-y divide-border">
              {notificationPreferenceItems.map((preference) => {
                const switchId = `notification-${preference.key}`;

                return (
                  <div key={preference.key} className="flex min-h-[68px] items-center justify-between gap-4 px-4 py-3 md:px-6">
                    <label htmlFor={switchId} className="min-w-0 flex-1 cursor-pointer">
                      <span className="block text-sm font-medium text-foreground">
                        {preference.title}
                      </span>
                      <span className="mt-0.5 block text-xs leading-5 text-muted-foreground md:text-sm">
                        {preference.description}
                      </span>
                    </label>
                    <Switch
                      id={switchId}
                      checked={preference.channelPreferences.inApp}
                      onCheckedChange={(checked) =>
                        handleNotificationChannelChange(preference.key, "inApp", checked)
                      }
                      aria-label={`${preference.title} ${t.settingsInAppNotifications}`}
                      disabled={!preference.isLive}
                    />
                  </div>
                );
              })}

              <div className="flex min-h-[64px] items-center justify-between gap-4 px-4 py-3 md:px-6">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-foreground">
                    {t.settingsEmailNotifications}
                  </p>
                  <p className="mt-0.5 text-xs leading-5 text-muted-foreground md:text-sm">
                    {t.settingsEmailNotificationsDescription}
                  </p>
                </div>
                <span className="shrink-0 rounded-full border border-border bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground">
                  {t.settingsPreviewBadge}
                </span>
              </div>
            </div>

            <div className="flex flex-col gap-2 border-t border-border bg-muted/30 px-4 py-3 sm:flex-row sm:items-center sm:justify-between md:px-6">
              <p className="max-w-3xl text-xs leading-5 text-muted-foreground">
                {notificationPreferencesAvailable
                  ? t.settingsNotificationPreferencesLiveNote
                  : t.settingsNotificationPreferencesUnavailableNote}
              </p>
              {notificationPreferencesAvailable ? (
                <Button
                  type="button"
                  size="sm"
                  className="h-11 self-start rounded-xl px-4 sm:self-center"
                  onClick={handleNotificationPreferencesSave}
                  disabled={isSavingNotificationPreferences || !hasNotificationPreferenceChanges}
                >
                  {isSavingNotificationPreferences ? t.saving : t.settingsSaveChanges}
                </Button>
              ) : null}
            </div>
          </section>

          <section aria-labelledby="settings-profile-title" className="border-t border-border">
            <div className="border-b border-border px-4 py-3 md:px-6 md:py-5">
              <h2 id="settings-profile-title" className="text-base font-semibold text-foreground md:text-lg">
                {t.settingsProfileTitle}
              </h2>
              <p className="mt-0.5 text-xs leading-5 text-muted-foreground md:text-sm">
                {t.settingsProfileDescription}
              </p>
            </div>

            <div className="flex min-h-[68px] items-center justify-between gap-4 px-4 py-3 md:px-6">
              <label htmlFor="hide-profile-bio" className="min-w-0 flex-1 cursor-pointer">
                <span className="block text-sm font-medium text-foreground">
                  {t.settingsHideBioOnListingPageTitle}
                </span>
                <span className="mt-0.5 block text-xs leading-5 text-muted-foreground md:text-sm">
                  {t.settingsHideBioOnListingPageDescription}
                </span>
                {!hasBio ? (
                  <span className="mt-0.5 block text-xs leading-5 text-muted-foreground">
                    {t.settingsNoBioYet}
                  </span>
                ) : null}
              </label>
              <Switch
                id="hide-profile-bio"
                checked={hideBioOnListingPage}
                onCheckedChange={setHideBioOnListingPage}
                disabled={isSavingBioVisibility}
                aria-label={t.settingsHideBioOnListingPageTitle}
              />
            </div>

            {userEmail ? (
              <div className="flex items-start justify-between gap-4 border-t border-border px-4 py-3 md:items-center md:px-6">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-foreground">{t.email}</p>
                  <p className="mt-0.5 break-all text-xs leading-5 text-muted-foreground md:text-sm">
                    {userEmail}
                  </p>
                </div>
              </div>
            ) : null}

            <div className="flex justify-end border-t border-border bg-muted/30 px-4 py-3 md:px-6">
              <Button
                type="button"
                size="sm"
                className="h-11 rounded-xl px-4"
                onClick={handleBioVisibilitySave}
                disabled={isSavingBioVisibility || !hasBioVisibilityChanges}
              >
                {isSavingBioVisibility ? t.saving : t.settingsSaveChanges}
              </Button>
            </div>
          </section>
        </Card>

        <Card className="gap-0 rounded-2xl border-destructive/30 bg-card py-0 shadow-sm ring-border md:rounded-3xl">
          <CardContent className="px-4 py-3 md:px-6 md:py-5">
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-destructive/10 text-destructive">
                <AlertTriangle className="size-4" />
              </div>
              <div className="min-w-[11rem] flex-1">
                <CardTitle className="text-base text-foreground md:text-lg">
                  {t.settingsDangerZoneTitle}
                </CardTitle>
                <CardDescription className="mt-0.5 text-xs leading-5 md:text-sm">
                  {t.settingsDeleteAccountDescription}
                </CardDescription>
              </div>

              <AlertDialog
                onOpenChange={(open) => {
                  if (!open) {
                    setConfirmationEmail("");
                  }
                }}
              >
                <AlertDialogTrigger asChild>
                  <Button
                    type="button"
                    variant="destructive"
                    size="sm"
                    className="h-11 rounded-xl px-4"
                    disabled={!deleteAccountAvailable}
                  >
                    <Trash2 className="size-4" />
                    <span>{t.settingsDeleteAccountButton}</span>
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent className="max-h-[calc(100svh-2rem)] w-[calc(100%-2rem)] gap-3 overflow-y-auto p-4 sm:p-6">
                  <AlertDialogHeader className="gap-1 text-left">
                    <AlertDialogTitle>{t.settingsDeleteAccountDialogTitle}</AlertDialogTitle>
                    <AlertDialogDescription>
                      {t.settingsDeleteAccountDialogDescription}
                    </AlertDialogDescription>
                  </AlertDialogHeader>

                  <div className="rounded-xl border border-destructive/20 bg-destructive/5 p-3 sm:p-4">
                    <p className="text-sm font-medium text-foreground">
                      {t.settingsDeleteAccountConsequencesTitle}
                    </p>
                    <ul className="mt-2 grid gap-1 text-xs leading-5 text-muted-foreground sm:grid-cols-2 sm:text-sm">
                      <li>{t.settingsDeleteAccountConsequenceListings}</li>
                      <li>{t.settingsDeleteAccountConsequenceMessages}</li>
                      <li>{t.settingsDeleteAccountConsequenceProfile}</li>
                      <li>{t.settingsDeleteAccountConsequencePreferences}</li>
                    </ul>
                  </div>

                  <div className="rounded-xl border border-border bg-background p-3 sm:p-4">
                    <p className="text-sm font-medium text-foreground">
                      {t.settingsDeleteAccountConfirmLabel}
                    </p>
                    <p className="mt-1 text-xs leading-5 text-muted-foreground sm:text-sm">
                      {t.settingsDeleteAccountConfirmEmailHelp}
                      <span className="break-all font-mono font-semibold text-foreground">{userEmail}</span>
                      {t.settingsDeleteAccountConfirmEmailSuffix}
                    </p>
                    <Input
                      type="email"
                      value={confirmationEmail}
                      onChange={(event) => setConfirmationEmail(event.target.value)}
                      placeholder={userEmail}
                      className="mt-3"
                    />
                  </div>

                  <AlertDialogFooter>
                    <AlertDialogCancel className="h-11" disabled={isDeletingAccount}>
                      {t.cancel}
                    </AlertDialogCancel>
                    <AlertDialogAction
                      onClick={handleDeleteAccount}
                      disabled={isDeletingAccount || !emailMatches}
                      className="h-11 bg-destructive/10 text-destructive hover:bg-destructive/20"
                    >
                      {isDeletingAccount
                        ? t.settingsDeletingAccount
                        : t.settingsDeleteAccountAction}
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>

            {!deleteAccountAvailable ? (
              <p className="mt-3 border-t border-destructive/15 pt-3 text-xs leading-5 text-muted-foreground">
                {t.settingsDeleteAccountUnavailable}
              </p>
            ) : null}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
