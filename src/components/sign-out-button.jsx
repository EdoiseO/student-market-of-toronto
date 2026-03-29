"use client"

import { useRouter } from "next/navigation";

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
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { createClient } from "@/utils/supabase/client";
import { LogOutIcon } from "lucide-react";
import { useLanguage } from "@/context/LanguageContext";

export function SignOutButton() {
  const router = useRouter();
  const supabase = createClient();
  const { t } = useLanguage();

  async function handleSignOut() {
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="outline" className="w-full justify-start rounded-xl">
          <LogOutIcon />
          <span>{t.signOut ?? (t.logout ?? (t.signOutLabel ?? (t.signOutText ?? "Sign Out")))}</span>
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t.signOutTitle ?? (t.signOutConfirm ?? (t.signOutQuestion ?? "Sign out of your account?"))}</AlertDialogTitle>
          <AlertDialogDescription>
            {t.signOutDescription ?? (t.signOutDesc ?? "You will be returned to the login page and need to sign in again to access your dashboard.")}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t.cancel}</AlertDialogCancel>
          <AlertDialogAction onClick={handleSignOut}>
            {t.signOut ?? (t.logout ?? (t.signOutLabel ?? (t.signOutText ?? "Sign Out")))}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
