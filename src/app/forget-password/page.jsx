"use client";

import Link from "next/link";
import { useState } from "react";

import { AuthPageBrand } from "@/components/auth-page-brand";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { useLanguage } from "@/context/LanguageContext";
import { Input } from "@/components/ui/input";
import { createClient } from "@/utils/supabase/client";

export default function ForgotPasswordPage() {
  const supabase = createClient();
  const { t } = useLanguage();

  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");

  async function handleSubmit(e) {
    e.preventDefault();
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || window.location.origin;

    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${appUrl}/auth/callback?next=/reset-password`,
    });

    if (error) {
      setMessage(error.message);
    } else {
      setMessage(t.checkEmailResetLink);
    }
  }

  return (
    <main className="flex min-h-svh w-full items-start justify-center overflow-y-auto bg-zinc-100 px-4 py-6 dark:bg-background sm:items-center md:p-6">
      <div className="flex w-full max-w-sm flex-col gap-6">
        <AuthPageBrand />
        <Card>
          <CardHeader>
            <CardTitle className="text-center">{t.forgotPasswordTitle}</CardTitle>
            <CardDescription>{t.forgotPasswordDescription}</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit}>
              <FieldGroup>
                <Field>
                  <FieldLabel htmlFor="email">{t.email}</FieldLabel>
                  <Input
                    id="email"
                    type="email"
                    autoComplete="email"
                    placeholder="m@example.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                  />
                  {message ? (
                    <p role="status" className="text-sm text-zinc-600 dark:text-muted-foreground">{message}</p>
                  ) : null}
                </Field>

                <Field>
                  <Button type="submit" className="w-full">{t.sendResetLink}</Button>
                  <FieldDescription className="text-center">
                    {t.rememberedPassword} <Link href="/login">{t.backToLogin}</Link>
                  </FieldDescription>
                </Field>
              </FieldGroup>
            </form>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
