"use client";

import Link from "next/link";
import { useRef, useState } from "react";

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

export default function ForgotPasswordPage() {
  const { t } = useLanguage();

  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const pending = useRef(false);

  async function handleSubmit(e) {
    e.preventDefault();
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setMessage("");
    setFailed(false);
    try {
      const response = await fetch("/api/auth/recovery", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "request", email }),
      });
      if (!response.ok) throw new Error("Reset request unavailable");
      setMessage(t.checkEmailResetLink);
    } catch {
      setFailed(true);
      setMessage(t.recoveryUnavailable);
    } finally {
      pending.current = false;
      setBusy(false);
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
            <form onSubmit={handleSubmit} aria-busy={busy}>
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
                    disabled={busy}
                  />
                  {message ? (
                    <p role={failed ? "alert" : "status"} className="text-sm text-zinc-600 dark:text-muted-foreground">{message}</p>
                  ) : null}
                </Field>

                <Field>
                  <Button type="submit" className="w-full" disabled={busy}>{busy ? t.sendingResetLink : t.sendResetLink}</Button>
                  <p role="status" className="sr-only">{busy ? t.sendingResetLink : ""}</p>
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
