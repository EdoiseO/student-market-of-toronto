"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
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
  FieldTitle,
} from "@/components/ui/field";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Separator } from "@/components/ui/separator";
import { useLanguage } from "@/context/LanguageContext";
import { createClient } from "@/utils/supabase/client";

export function DashboardSettingsContent({
  userEmail,
  userId,
  initialHideBioOnListingPage,
  hasBio,
}) {
  const { t } = useLanguage();
  const router = useRouter();
  const supabase = React.useMemo(() => createClient(), []);
  const [hideBioOnListingPage, setHideBioOnListingPage] = React.useState(
    initialHideBioOnListingPage,
  );
  const [savedHideBioOnListingPage, setSavedHideBioOnListingPage] = React.useState(
    initialHideBioOnListingPage,
  );
  const [isSavingBioVisibility, setIsSavingBioVisibility] = React.useState(false);

  React.useEffect(() => {
    setHideBioOnListingPage(initialHideBioOnListingPage);
    setSavedHideBioOnListingPage(initialHideBioOnListingPage);
  }, [initialHideBioOnListingPage]);

  const hasBioVisibilityChanges = hideBioOnListingPage !== savedHideBioOnListingPage;

  const appearanceOptions = [
    {
      value: "system",
      title: t.settingsThemeSystem,
      description: t.settingsThemeSystemDescription,
    },
    {
      value: "light",
      title: t.settingsThemeLight,
      description: t.settingsThemeLightDescription,
    },
    {
      value: "dark",
      title: t.settingsThemeDark,
      description: t.settingsThemeDarkDescription,
    },
  ];

  const notificationPreferences = [
    {
      key: "sold",
      title: t.settingsSoldNotificationsTitle,
      description: t.settingsSoldNotificationsDescription,
      emailEnabled: true,
      inAppEnabled: true,
    },
    {
      key: "favourite",
      title: t.settingsFavouriteNotificationsTitle,
      description: t.settingsFavouriteNotificationsDescription,
      emailEnabled: true,
      inAppEnabled: true,
    },
    {
      key: "messages",
      title: t.settingsMessagesNotificationsTitle,
      description: t.settingsMessagesNotificationsDescription,
      emailEnabled: true,
      inAppEnabled: true,
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

  return (
    <>
      <section className="rounded-3xl bg-white p-8 shadow-sm ring-1 ring-zinc-200">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-4xl font-bold tracking-tight text-zinc-950">{t.settings}</h1>
          <Badge
            variant="outline"
            className="rounded-full border-zinc-200 bg-zinc-50 px-3 py-1 text-zinc-600"
          >
            {t.settingsPreviewBadge}
          </Badge>
        </div>
        <p className="mt-3 max-w-4xl text-base text-zinc-600">{t.settingsDescription}</p>
      </section>

      <div className="grid gap-6 xl:grid-cols-2">
        <Card className="rounded-3xl bg-white py-0 shadow-sm ring-zinc-200">
          <CardHeader className="border-b border-zinc-200 px-6 py-6">
            <CardTitle className="text-2xl text-zinc-950">{t.settingsAppearanceTitle}</CardTitle>
            <CardDescription>{t.settingsAppearanceDescription}</CardDescription>
          </CardHeader>

          <CardContent className="space-y-6 px-6 py-8">
            <FieldGroup>
              <FieldContent>
                <FieldTitle className="text-base text-zinc-950">
                  {t.settingsThemePreference}
                </FieldTitle>
                <FieldDescription>{t.settingsThemePreferenceDescription}</FieldDescription>
              </FieldContent>

              <RadioGroup defaultValue="system" className="gap-3">
                {appearanceOptions.map((option) => (
                  <div
                    key={option.value}
                    className="rounded-2xl border border-zinc-200 bg-zinc-50 p-4"
                  >
                    <Field orientation="horizontal" data-disabled="true" className="items-start gap-3">
                      <RadioGroupItem value={option.value} disabled className="mt-0.5" />
                      <FieldContent>
                        <FieldTitle className="text-zinc-950">{option.title}</FieldTitle>
                        <FieldDescription>{option.description}</FieldDescription>
                      </FieldContent>
                    </Field>
                  </div>
                ))}
              </RadioGroup>
            </FieldGroup>

            <Separator />

            <div className="rounded-2xl border border-dashed border-zinc-200 bg-zinc-50/70 px-4 py-4">
              <p className="text-sm text-zinc-600">{t.settingsPreviewNote}</p>
            </div>
          </CardContent>
        </Card>

        <Card className="rounded-3xl bg-white py-0 shadow-sm ring-zinc-200">
          <CardHeader className="border-b border-zinc-200 px-6 py-6">
            <CardTitle className="text-2xl text-zinc-950">{t.settingsNotificationsTitle}</CardTitle>
            <CardDescription>{t.settingsNotificationsDescription}</CardDescription>
          </CardHeader>

          <CardContent className="space-y-6 px-6 py-8">
            <FieldGroup>
              <FieldContent>
                <FieldTitle className="text-base text-zinc-950">
                  {t.settingsNotificationTypesTitle}
                </FieldTitle>
                <FieldDescription>{t.settingsNotificationTypesDescription}</FieldDescription>
              </FieldContent>

              {notificationPreferences.map((preference) => (
                <div
                  key={preference.key}
                  className="rounded-2xl border border-zinc-200 bg-zinc-50 p-4"
                >
                  <div className="space-y-4">
                    <div>
                      <p className="text-sm font-medium text-zinc-950">{preference.title}</p>
                      <p className="mt-1 text-sm text-zinc-500">{preference.description}</p>
                    </div>

                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="rounded-xl border border-zinc-200 bg-white px-3 py-3">
                        <Field
                          orientation="horizontal"
                          data-disabled="true"
                          className="items-start gap-3"
                        >
                          <Checkbox checked={preference.emailEnabled} disabled className="mt-0.5" />
                          <FieldContent>
                            <FieldTitle className="text-zinc-950">
                              {t.settingsEmailNotifications}
                            </FieldTitle>
                            <FieldDescription>
                              {t.settingsEmailNotificationsDescription}
                            </FieldDescription>
                          </FieldContent>
                        </Field>
                      </div>

                      <div className="rounded-xl border border-zinc-200 bg-white px-3 py-3">
                        <Field
                          orientation="horizontal"
                          data-disabled="true"
                          className="items-start gap-3"
                        >
                          <Checkbox checked={preference.inAppEnabled} disabled className="mt-0.5" />
                          <FieldContent>
                            <FieldTitle className="text-zinc-950">
                              {t.settingsInAppNotifications}
                            </FieldTitle>
                            <FieldDescription>
                              {t.settingsInAppNotificationsDescription}
                            </FieldDescription>
                          </FieldContent>
                        </Field>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </FieldGroup>

            <Separator />

            <FieldGroup>
              <div className="rounded-2xl border border-zinc-200 bg-zinc-50 p-4">
                <Field className="gap-3" data-disabled="true">
                  <FieldContent>
                    <FieldTitle className="text-zinc-950">{t.settingsEmailCadenceTitle}</FieldTitle>
                    <FieldDescription>{t.settingsEmailCadenceDescription}</FieldDescription>
                  </FieldContent>

                  <NativeSelect defaultValue="weekly" disabled className="w-full">
                    <NativeSelectOption value="instant">
                      {t.settingsEmailCadenceInstant}
                    </NativeSelectOption>
                    <NativeSelectOption value="daily">{t.settingsEmailCadenceDaily}</NativeSelectOption>
                    <NativeSelectOption value="weekly">
                      {t.settingsEmailCadenceWeekly}
                    </NativeSelectOption>
                  </NativeSelect>
                </Field>
              </div>

              {userEmail ? (
                <div className="rounded-2xl border border-dashed border-zinc-200 bg-zinc-50/70 px-4 py-4">
                  <p className="text-sm font-medium text-zinc-950">{t.email}</p>
                  <p className="mt-1 break-all text-sm text-zinc-500">{userEmail}</p>
                </div>
              ) : null}
            </FieldGroup>
          </CardContent>
        </Card>
      </div>

      <Card className="rounded-3xl bg-white py-0 shadow-sm ring-zinc-200">
        <CardHeader className="border-b border-zinc-200 px-6 py-6">
          <CardTitle className="text-2xl text-zinc-950">{t.settingsProfileTitle}</CardTitle>
          <CardDescription>{t.settingsProfileDescription}</CardDescription>
        </CardHeader>

        <CardContent className="space-y-6 px-6 py-8">
          <div className="rounded-2xl border border-zinc-200 bg-zinc-50 p-4">
            <Field orientation="horizontal" className="items-start gap-3">
              <Checkbox
                checked={hideBioOnListingPage}
                onCheckedChange={(checked) => setHideBioOnListingPage(checked === true)}
                disabled={isSavingBioVisibility}
                aria-label={t.settingsHideBioOnListingPageTitle}
                className="mt-0.5"
              />
              <FieldContent>
                <FieldTitle className="text-zinc-950">
                  {t.settingsHideBioOnListingPageTitle}
                </FieldTitle>
                <FieldDescription>{t.settingsHideBioOnListingPageDescription}</FieldDescription>
                <p className="mt-2 text-sm text-zinc-500">{t.settingsBioIdentityNote}</p>
                {!hasBio ? (
                  <p className="mt-2 text-sm text-zinc-500">{t.settingsNoBioYet}</p>
                ) : null}
              </FieldContent>
            </Field>
          </div>

          <div className="flex justify-end">
            <Button
              type="button"
              className="rounded-xl px-5"
              onClick={handleBioVisibilitySave}
              disabled={isSavingBioVisibility || !hasBioVisibilityChanges}
            >
              {isSavingBioVisibility ? t.saving : t.settingsSaveChanges}
            </Button>
          </div>
        </CardContent>
      </Card>
    </>
  );
}
