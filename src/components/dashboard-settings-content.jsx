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
import { Input } from "@/components/ui/input";
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
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-bold tracking-tight text-foreground md:text-4xl">{t.settings}</h1>
        </div>
        <p className="mt-1 max-w-4xl text-sm leading-5 text-muted-foreground md:mt-3 md:text-base md:leading-6">{t.settingsDescription}</p>
      </section>

      <div className="flex flex-col gap-3 md:gap-4">
        <Card className="h-full rounded-2xl bg-card py-0 shadow-sm ring-border md:rounded-3xl">
          <CardHeader className="border-b border-border px-4 py-3 md:px-6 md:py-6">
            <CardTitle className="text-lg text-foreground md:text-2xl">{t.settingsAppearanceTitle}</CardTitle>
            <CardDescription className="text-xs leading-5 md:text-sm">{t.settingsAppearanceDescription}</CardDescription>
          </CardHeader>

          <CardContent className="space-y-4 px-4 py-4 md:space-y-6 md:px-6 md:py-8">
            <FieldGroup className="gap-3 md:gap-5">
              <FieldContent>
                <FieldTitle className="text-sm text-foreground md:text-base">
                  {t.settingsThemePreference}
                </FieldTitle>
                <FieldDescription className="text-xs leading-5 md:text-sm">{t.settingsThemePreferenceDescription}</FieldDescription>
              </FieldContent>

              <RadioGroup
                value={themePreference}
                onValueChange={handleThemePreferenceChange}
                className="grid w-full max-w-[400px] grid-cols-3 gap-2 md:gap-3"
              >
                {appearanceOptions.map((option) => (
                  <FieldLabel
                    key={option.value}
                    htmlFor={`theme-preview-${option.value}`}
                    className={cn(
                      "relative flex min-h-11 w-full items-center justify-center rounded-xl border px-2 py-2 text-center",
                      themePreference === option.value
                        ? "border-foreground bg-accent"
                        : "border-border bg-muted/40",
                    )}
                  >
                    <FieldTitle className="text-xs text-foreground md:text-sm">{option.title}</FieldTitle>
                    <RadioGroupItem value={option.value} id={`theme-preview-${option.value}`} className="sr-only" />
                  </FieldLabel>
                ))}
              </RadioGroup>
            </FieldGroup>

            <Separator />

            <div className="rounded-xl border border-dashed border-border bg-muted/40 p-3 md:rounded-2xl md:px-4 md:py-4">
              <p className="text-xs leading-5 text-muted-foreground md:text-sm">{t.settingsThemeLiveNote}</p>
            </div>
          </CardContent>
        </Card>

        <Card className="h-full rounded-2xl bg-card py-0 shadow-sm ring-border md:rounded-3xl">
          <CardHeader className="border-b border-border px-4 py-3 md:px-6 md:py-6">
            <CardTitle className="text-lg text-foreground md:text-2xl">{t.settingsNotificationsTitle}</CardTitle>
            <CardDescription className="text-xs leading-5 md:text-sm">{t.settingsNotificationsDescription}</CardDescription>
          </CardHeader>

          <CardContent className="space-y-4 px-4 py-4 md:space-y-6 md:px-6 md:py-8">
            <FieldGroup className="gap-3 md:gap-5">
              <FieldContent>
                <FieldTitle className="text-sm text-foreground md:text-base">
                  {t.settingsNotificationTypesTitle}
                </FieldTitle>
                <FieldDescription className="text-xs leading-5 md:text-sm">{t.settingsNotificationTypesDescription}</FieldDescription>
              </FieldContent>

              {notificationPreferenceItems.map((preference) => (
                <div
                  key={preference.key}
                  className="rounded-xl border border-border bg-muted/40 p-3 dark:bg-muted/70 dark:ring-1 dark:ring-white/8 md:rounded-2xl md:p-4"
                >
                  <div className="space-y-3 md:space-y-4">
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
                      <p className="mt-0.5 text-xs leading-5 text-muted-foreground md:mt-1 md:text-sm">{preference.description}</p>
                    </div>

                    <div className="grid gap-2 sm:grid-cols-2 md:gap-3">
                      <div className="rounded-lg border border-border bg-background p-2.5 dark:border-white/10 dark:bg-card md:rounded-xl md:px-3 md:py-3">
                        <Field
                          orientation="horizontal"
                          className="items-center justify-between gap-2 md:items-start md:gap-3"
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
                            <FieldDescription className="hidden md:block">
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

                      <div className="rounded-lg border border-border bg-background p-2.5 dark:border-white/10 dark:bg-card md:rounded-xl md:px-3 md:py-3">
                        <Field
                          orientation="horizontal"
                          className="items-center justify-between gap-2 md:items-start md:gap-3"
                        >
                          <FieldContent>
                            <FieldTitle className="text-foreground">
                              {t.settingsInAppNotifications}
                            </FieldTitle>
                            <FieldDescription className="hidden md:block">
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

            <div className="rounded-xl border border-dashed border-border bg-muted/40 p-3 md:rounded-2xl md:px-4 md:py-4">
              <p className="text-xs leading-5 text-muted-foreground md:text-sm">
                {notificationPreferencesAvailable
                  ? t.settingsNotificationPreferencesLiveNote
                  : t.settingsNotificationPreferencesUnavailableNote}
              </p>
            </div>

            {notificationPreferencesAvailable ? (
              <div className="flex justify-end">
                <Button
                  type="button"
                  size="sm"
                  className="rounded-xl px-4"
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

                <div className="rounded-xl border border-dashed border-border bg-muted/40 p-3 md:rounded-2xl md:px-4 md:py-4">
                  <p className="text-sm font-medium text-foreground">{t.email}</p>
                  <p className="mt-1 break-all text-sm text-muted-foreground">{userEmail}</p>
                </div>
              </>
            ) : null}
          </CardContent>
        </Card>

        <Card className="h-full rounded-2xl bg-card py-0 shadow-sm ring-border md:rounded-3xl">
          <CardHeader className="border-b border-border px-4 py-3 md:px-6 md:py-6">
            <CardTitle className="text-lg text-foreground md:text-2xl">{t.settingsProfileTitle}</CardTitle>
            <CardDescription className="text-xs leading-5 md:text-sm">{t.settingsProfileDescription}</CardDescription>
          </CardHeader>

          <CardContent className="space-y-4 px-4 py-4 md:space-y-6 md:px-6 md:py-8">
            <div className="rounded-xl border border-border bg-muted/40 p-3 md:rounded-2xl md:p-4">
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
                  <p className="mt-1 text-xs leading-5 text-muted-foreground md:mt-2 md:text-sm">{t.settingsBioIdentityNote}</p>
                  {!hasBio ? (
                    <p className="mt-1 text-xs leading-5 text-muted-foreground md:mt-2 md:text-sm">{t.settingsNoBioYet}</p>
                  ) : null}
                </FieldContent>
              </Field>
            </div>

            <div className="flex justify-end">
              <Button
                type="button"
                size="sm"
                className="rounded-xl px-4"
                onClick={handleBioVisibilitySave}
                disabled={isSavingBioVisibility || !hasBioVisibilityChanges}
              >
                {isSavingBioVisibility ? t.saving : t.settingsSaveChanges}
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card className="h-full rounded-2xl border-destructive/30 bg-card py-0 shadow-sm ring-border md:rounded-3xl">
          <CardHeader className="border-b border-destructive/20 px-4 py-3 md:px-6 md:py-6">
            <div className="flex items-start gap-3">
              <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-destructive/10 text-destructive md:size-11 md:rounded-2xl">
                <AlertTriangle className="size-5" />
              </div>
              <div>
                <CardTitle className="text-lg text-foreground md:text-2xl">{t.settingsDangerZoneTitle}</CardTitle>
                <CardDescription className="text-xs leading-5 md:text-sm">{t.settingsDangerZoneDescription}</CardDescription>
              </div>
            </div>
          </CardHeader>

          <CardContent className="space-y-4 px-4 py-4 md:space-y-6 md:px-6 md:py-8">
            <div className="rounded-xl border border-destructive/20 bg-destructive/5 p-3 md:rounded-2xl md:p-5">
              <div className="space-y-2">
                <p className="text-base font-semibold text-foreground">
                  {t.settingsDeleteAccountTitle}
                </p>
                <p className="text-sm text-muted-foreground">
                  {t.settingsDeleteAccountDescription}
                </p>
              </div>

              <div className="mt-3 rounded-xl border border-destructive/15 bg-background p-3 md:mt-4 md:px-4 md:py-4">
                <p className="text-sm font-medium text-foreground">
                  {t.settingsDeleteAccountConsequencesTitle}
                </p>
                <ul className="mt-2 grid gap-1 text-xs leading-5 text-muted-foreground sm:grid-cols-2 md:mt-3 md:gap-2 md:text-sm">
                  <li>{t.settingsDeleteAccountConsequenceListings}</li>
                  <li>{t.settingsDeleteAccountConsequenceMessages}</li>
                  <li>{t.settingsDeleteAccountConsequenceProfile}</li>
                  <li>{t.settingsDeleteAccountConsequencePreferences}</li>
                </ul>
              </div>

              {!deleteAccountAvailable ? (
                <div className="mt-3 rounded-xl border border-dashed border-border bg-muted/40 p-3 text-xs leading-5 text-muted-foreground md:mt-4 md:px-4 md:py-4 md:text-sm">
                  {t.settingsDeleteAccountUnavailable}
                </div>
              ) : null}

              <div className="mt-3 flex justify-end md:mt-5">
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
                      className="rounded-xl px-4"
                      disabled={!deleteAccountAvailable}
                    >
                      <Trash2 className="size-4" />
                      <span>{t.settingsDeleteAccountButton}</span>
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>{t.settingsDeleteAccountDialogTitle}</AlertDialogTitle>
                      <AlertDialogDescription>
                        {t.settingsDeleteAccountDialogDescription}
                      </AlertDialogDescription>
                    </AlertDialogHeader>

                    <div className="rounded-2xl border border-destructive/20 bg-destructive/5 px-4 py-4">
                      <p className="text-sm font-medium text-foreground">
                        {t.settingsDeleteAccountConsequencesTitle}
                      </p>
                      <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
                        <li>{t.settingsDeleteAccountConsequenceListings}</li>
                        <li>{t.settingsDeleteAccountConsequenceMessages}</li>
                        <li>{t.settingsDeleteAccountConsequenceProfile}</li>
                        <li>{t.settingsDeleteAccountConsequencePreferences}</li>
                      </ul>
                    </div>

                    <div className="rounded-xl border border-border bg-background px-4 py-4">
                      <div className="space-y-2">
                        <p className="text-sm font-medium text-foreground">
                          {t.settingsDeleteAccountConfirmLabel}
                        </p>
                        <p className="text-sm text-muted-foreground">
                          {t.settingsDeleteAccountConfirmEmailHelp}
                          <span className="font-mono font-semibold text-foreground">{userEmail}</span>
                          {t.settingsDeleteAccountConfirmEmailSuffix}
                        </p>
                        <Input
                          type="email"
                          value={confirmationEmail}
                          onChange={(event) => setConfirmationEmail(event.target.value)}
                          placeholder={userEmail}
                        />
                      </div>
                    </div>

                    <AlertDialogFooter>
                      <AlertDialogCancel disabled={isDeletingAccount}>{t.cancel}</AlertDialogCancel>
                      <AlertDialogAction
                        onClick={handleDeleteAccount}
                        disabled={isDeletingAccount || !emailMatches}
                        className="bg-destructive/10 text-destructive hover:bg-destructive/20"
                      >
                        {isDeletingAccount
                          ? t.settingsDeletingAccount
                          : t.settingsDeleteAccountAction}
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
