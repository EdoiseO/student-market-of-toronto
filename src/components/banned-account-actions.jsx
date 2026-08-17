"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
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
import { Input } from "@/components/ui/input";
import { useLanguage } from "@/context/LanguageContext";
import { createClient } from "@/utils/supabase/client";

export function BannedAccountActions() {
  const router = useRouter();
  const { t } = useLanguage();
  const supabase = React.useMemo(() => createClient(), []);
  const [isSigningOut, setIsSigningOut] = React.useState(false);
  const [isDeletingAccount, setIsDeletingAccount] = React.useState(false);
  const [confirmationPassword, setConfirmationPassword] = React.useState("");

  async function handleSignOut() {
    if (isSigningOut) {
      return;
    }

    setIsSigningOut(true);
    await supabase.auth.signOut();
    router.replace("/login");
    router.refresh();
  }

  async function handleDeleteAccount() {
    if (isDeletingAccount || !confirmationPassword) {
      return;
    }

    setIsDeletingAccount(true);

    try {
      const response = await fetch("/api/account/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: confirmationPassword }),
      });
      const payload = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(payload?.error || t.settingsDeleteAccountError);
      }

      await supabase.auth.signOut();
      toast.success(t.settingsDeleteAccountSuccess);
      router.replace("/");
      router.refresh();
    } catch (error) {
      console.error("Failed to delete restricted account", error);
      toast.error(error.message || t.settingsDeleteAccountError);
    } finally {
      setIsDeletingAccount(false);
      setConfirmationPassword("");
    }
  }

  return (
    <>
      <Button type="button" className="rounded-xl" onClick={handleSignOut} disabled={isSigningOut}>
        {isSigningOut ? t.saving : t.signOut}
      </Button>

      <AlertDialog
        onOpenChange={(open) => {
          if (!open) {
            setConfirmationPassword("");
          }
        }}
      >
        <AlertDialogTrigger asChild>
          <Button type="button" variant="destructive" className="rounded-xl">
            <Trash2 className="size-4" />
            <span>{t.settingsDeleteAccountButton}</span>
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent className="max-h-[calc(100svh-2rem)] w-[calc(100%-2rem)] max-w-lg overflow-y-auto p-4 sm:p-6">
          <AlertDialogHeader className="text-left">
            <AlertDialogTitle>{t.settingsDeleteAccountDialogTitle}</AlertDialogTitle>
            <AlertDialogDescription>
              {t.settingsDeleteAccountDialogDescription}
            </AlertDialogDescription>
          </AlertDialogHeader>

          <div className="rounded-xl border border-destructive/20 bg-destructive/5 p-3 text-left sm:p-4">
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

          <div className="rounded-xl border border-border bg-background p-3 text-left sm:p-4">
            <label
              htmlFor="banned-account-delete-password"
              className="text-sm font-medium text-foreground"
            >
              {t.settingsDeleteAccountConfirmLabel}
            </label>
            <p className="mt-1 text-xs leading-5 text-muted-foreground sm:text-sm">
              {t.settingsDeleteAccountConfirmPasswordHelp}
            </p>
            <Input
              id="banned-account-delete-password"
              type="password"
              autoComplete="current-password"
              value={confirmationPassword}
              onChange={(event) => setConfirmationPassword(event.target.value)}
              placeholder={t.settingsDeleteAccountConfirmPasswordPlaceholder}
              className="mt-3"
            />
          </div>

          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeletingAccount}>
              {t.cancel}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteAccount}
              disabled={isDeletingAccount || !confirmationPassword}
              className="bg-destructive/10 text-destructive hover:bg-destructive/20"
            >
              {isDeletingAccount
                ? t.settingsDeletingAccount
                : t.settingsDeleteAccountAction}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
