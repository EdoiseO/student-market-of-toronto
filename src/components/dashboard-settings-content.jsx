"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldTitle,
} from "@/components/ui/field";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Separator } from "@/components/ui/separator";
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
  const emailNotificationControlsLive = false;

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

  return (
    <>
      <section className="rounded-3xl bg-card p-8 shadow-sm ring-1 ring-border">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-4xl font-bold tracking-tight text-foreground">{t.settings}</h1>
        </div>
        <p className="mt-3 max-w-4xl text-base text-muted-foreground">{t.settingsDescription}</p>
      </section>

      <div className="flex flex-col gap-4">
        <Card className="h-full rounded-3xl bg-card py-0 shadow-sm ring-border">
          <CardHeader className="border-b border-border px-6 py-6">
            <CardTitle className="text-2xl text-foreground">{t.settingsAppearanceTitle}</CardTitle>
            <CardDescription>{t.settingsAppearanceDescription}</CardDescription>
          </CardHeader>

          <CardContent className="space-y-6 px-6 py-8">
            <FieldGroup>
              <FieldContent>
                <FieldTitle className="text-base text-foreground">
                  {t.settingsThemePreference}
                </FieldTitle>
                <FieldDescription>{t.settingsThemePreferenceDescription}</FieldDescription>
              </FieldContent>

              <RadioGroup
                value={themePreference}
                onValueChange={handleThemePreferenceChange}
                className="grid w-full max-w-[400px] grid-cols-1 gap-3 sm:grid-cols-3"
              >
                {appearanceOptions.map((option) => (
                  <FieldLabel
                    key={option.value}
                    htmlFor={`theme-preview-${option.value}`}
                    className={cn(
                      "w-full",
                      themePreference === option.value
                        ? "border-foreground bg-accent"
                        : "border-border bg-muted/40",
                    )}
                  >
                    <Field orientation="horizontal" className="items-center gap-3">
                      <FieldContent>
                        <FieldTitle className="text-sm text-foreground">{option.title}</FieldTitle>
                      </FieldContent>
                      <RadioGroupItem value={option.value} id={`theme-preview-${option.value}`} />
                    </Field>
                  </FieldLabel>
                ))}
              </RadioGroup>
            </FieldGroup>

            <Separator />

            <div className="rounded-2xl border border-dashed border-border bg-muted/40 px-4 py-4">
              <p className="text-sm text-muted-foreground">{t.settingsThemeLiveNote}</p>
            </div>
          </CardContent>
        </Card>

        <Card className="h-full rounded-3xl bg-card py-0 shadow-sm ring-border">
          <CardHeader className="border-b border-border px-6 py-6">
            <CardTitle className="text-2xl text-foreground">{t.settingsNotificationsTitle}</CardTitle>
            <CardDescription>{t.settingsNotificationsDescription}</CardDescription>
          </CardHeader>

          <CardContent className="space-y-6 px-6 py-8">
            <FieldGroup>
              <FieldContent>
                <FieldTitle className="text-base text-foreground">
                  {t.settingsNotificationTypesTitle}
                </FieldTitle>
                <FieldDescription>{t.settingsNotificationTypesDescription}</FieldDescription>
              </FieldContent>

              {notificationPreferenceItems.map((preference) => (
                <div
                  key={preference.key}
                  className="rounded-2xl border border-border bg-muted/40 p-4 dark:bg-muted/70 dark:ring-1 dark:ring-white/8"
                >
                  <div className="space-y-4">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-sm font-medium text-foreground">{preference.title}</p>
                        {!preference.isLive ? (
                          <Badge
                            variant="outline"
                            className="rounded-full border-border bg-background text-muted-foreground"
                          >
                            {t.settingsPreviewBadge}
                          </Badge>
                        ) : null}
                      </div>
                      <p className="mt-1 text-sm text-muted-foreground">{preference.description}</p>
                    </div>

                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="rounded-xl border border-border bg-background px-3 py-3 dark:border-white/10 dark:bg-card">
                        <Field
                          orientation="horizontal"
                          className="flex-col items-start gap-3 sm:flex-row sm:justify-between"
                        >
                          <FieldContent>
                            <div className="flex flex-wrap items-center gap-2">
                              <FieldTitle className="text-foreground">
                                {t.settingsEmailNotifications}
                              </FieldTitle>
                              {!emailNotificationControlsLive ? (
                                <Badge
                                  variant="outline"
                                  className="rounded-full border-border bg-background text-muted-foreground"
                                >
                                  {t.settingsPreviewBadge}
                                </Badge>
                              ) : null}
                            </div>
                            <FieldDescription>
                              {t.settingsEmailNotificationsDescription}
                            </FieldDescription>
                          </FieldContent>
                          <Switch
                            checked={preference.channelPreferences.email}
                            onCheckedChange={(checked) =>
                              handleNotificationChannelChange(preference.key, "email", checked)
                            }
                            aria-label={`${preference.title} ${t.settingsEmailNotifications}`}
                            className="mt-0.5"
                            disabled={!preference.isLive || !emailNotificationControlsLive}
                          />
                        </Field>
                      </div>

                      <div className="rounded-xl border border-border bg-background px-3 py-3 dark:border-white/10 dark:bg-card">
                        <Field
                          orientation="horizontal"
                          className="flex-col items-start gap-3 sm:flex-row sm:justify-between"
                        >
                          <FieldContent>
                            <FieldTitle className="text-foreground">
                              {t.settingsInAppNotifications}
                            </FieldTitle>
                            <FieldDescription>
                              {t.settingsInAppNotificationsDescription}
                            </FieldDescription>
                          </FieldContent>
                          <Switch
                            checked={preference.channelPreferences.inApp}
                            onCheckedChange={(checked) =>
                              handleNotificationChannelChange(preference.key, "inApp", checked)
                            }
                            aria-label={`${preference.title} ${t.settingsInAppNotifications}`}
                            className="mt-0.5"
                            disabled={!preference.isLive}
                          />
                        </Field>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </FieldGroup>

            <Separator />

            <div className="rounded-2xl border border-dashed border-border bg-muted/40 px-4 py-4">
              <p className="text-sm text-muted-foreground">
                {notificationPreferencesAvailable
                  ? t.settingsNotificationPreferencesLiveNote
                  : t.settingsNotificationPreferencesUnavailableNote}
              </p>
            </div>

            {notificationPreferencesAvailable ? (
              <div className="flex justify-stretch sm:justify-end">
                <Button
                  type="button"
                  className="w-full rounded-xl px-5 sm:w-auto"
                  onClick={handleNotificationPreferencesSave}
                  disabled={isSavingNotificationPreferences || !hasNotificationPreferenceChanges}
                >
                  {isSavingNotificationPreferences ? t.saving : t.settingsSaveChanges}
                </Button>
              </div>
            ) : null}

            {userEmail ? (
              <>
                <Separator />

                <div className="rounded-2xl border border-dashed border-border bg-muted/40 px-4 py-4">
                  <p className="text-sm font-medium text-foreground">{t.email}</p>
                  <p className="mt-1 break-all text-sm text-muted-foreground">{userEmail}</p>
                </div>
              </>
            ) : null}
          </CardContent>
        </Card>

        <Card className="h-full rounded-3xl bg-card py-0 shadow-sm ring-border">
          <CardHeader className="border-b border-border px-6 py-6">
            <CardTitle className="text-2xl text-foreground">{t.settingsProfileTitle}</CardTitle>
            <CardDescription>{t.settingsProfileDescription}</CardDescription>
          </CardHeader>

          <CardContent className="space-y-6 px-6 py-8">
            <div className="rounded-2xl border border-border bg-muted/40 p-4">
              <Field orientation="horizontal" className="items-start gap-3">
                <Checkbox
                  checked={hideBioOnListingPage}
                  onCheckedChange={(checked) => setHideBioOnListingPage(checked === true)}
                  disabled={isSavingBioVisibility}
                  aria-label={t.settingsHideBioOnListingPageTitle}
                  className="mt-0.5"
                />
                <FieldContent>
                  <FieldTitle className="text-foreground">
                    {t.settingsHideBioOnListingPageTitle}
                  </FieldTitle>
                  <FieldDescription>{t.settingsHideBioOnListingPageDescription}</FieldDescription>
                  <p className="mt-2 text-sm text-muted-foreground">{t.settingsBioIdentityNote}</p>
                  {!hasBio ? (
                    <p className="mt-2 text-sm text-muted-foreground">{t.settingsNoBioYet}</p>
                  ) : null}
                </FieldContent>
              </Field>
            </div>

            <div className="flex justify-stretch sm:justify-end">
              <Button
                type="button"
                className="w-full rounded-xl px-5 sm:w-auto"
                onClick={handleBioVisibilitySave}
                disabled={isSavingBioVisibility || !hasBioVisibilityChanges}
              >
                {isSavingBioVisibility ? t.saving : t.settingsSaveChanges}
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
