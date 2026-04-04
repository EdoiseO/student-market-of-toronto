"use client";
export const dynamic = "force-dynamic";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";

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

export default function ResetPasswordPage() {
  const supabase = useMemo(() => createClient(), []);
  const { t } = useLanguage();
  const router = useRouter();
  const searchParams = useSearchParams();

  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [sessionReady, setSessionReady] = useState(false);

  useEffect(() => {
    async function setResetSession() {
      const code = searchParams.get("code");
      const tokenHash = searchParams.get("token_hash");
      const type = searchParams.get("type");

      const hashParams = new URLSearchParams(window.location.hash.replace("#", ""));
      const accessToken = hashParams.get("access_token");
      const refreshToken = hashParams.get("refresh_token");
      const hashType = hashParams.get("type");

      if (accessToken && refreshToken && hashType === "recovery") {
        const { error } = await supabase.auth.setSession({
          access_token: accessToken,
          refresh_token: refreshToken,
        });

        if (error) {
          setMessage(error.message);
          setSessionReady(false);
        } else {
          setSessionReady(true);
        }

        setLoading(false);
        return;
      }

      if (code) {
        const { data, error } = await supabase.auth.exchangeCodeForSession(code);

        if (error) {
          setMessage(error.message);
          setSessionReady(false);
        } else {
          setSessionReady(Boolean(data?.session));
        }

        setLoading(false);
        return;
      }

      if (tokenHash && type === "recovery") {
        const { error } = await supabase.auth.verifyOtp({
          token_hash: tokenHash,
          type: "recovery",
        });

        if (error) {
          setMessage(error.message);
          setSessionReady(false);
        } else {
          const {
            data: { session },
          } = await supabase.auth.getSession();
          setSessionReady(Boolean(session));
        }

        setLoading(false);
        return;
      }

      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (session) {
        setSessionReady(true);
      } else {
        setMessage(t.invalidOrExpiredResetLink);
        setSessionReady(false);
      }

      setLoading(false);
    }

    setResetSession();
  }, [searchParams, supabase, t.invalidOrExpiredResetLink]);

  async function handleSubmit(e) {
    e.preventDefault();

    if (loading || !sessionReady) {
      setMessage(t.resetSessionNotReady);
      return;
    }

    if (password !== confirmPassword) {
      setMessage(t.passwordsDoNotMatch);
      return;
    }

    const { error } = await supabase.auth.updateUser({
      password: password,
    });

    if (error) {
      setMessage(error.message);
    } else {
      setMessage(t.passwordUpdatedRedirecting);
      setTimeout(() => {
        router.push("/login");
      }, 1500);
    }
  }

  if (loading) {
    return (
      <main className="flex min-h-svh w-full items-center justify-center bg-zinc-100 p-6 md:p-10">
        <div className="w-full max-w-sm">
          <Card>
            <CardContent className="p-8 text-center">
              <p className="text-sm text-zinc-600">{t.preparingResetSession}</p>
            </CardContent>
          </Card>
        </div>
      </main>
    );
  }

  return (
    <main className="flex min-h-svh w-full items-center justify-center bg-zinc-100 p-6 md:p-10">
      <div className="w-full max-w-sm">
        <Card>
          <CardHeader>
            <CardTitle className="text-center">{t.resetPasswordTitle}</CardTitle>
            <CardDescription>{t.resetPasswordDescription}</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit}>
              <FieldGroup>
                <Field>
                  <FieldLabel htmlFor="password">{t.newPassword}</FieldLabel>
                  <Input
                    id="password"
                    type="password"
                    placeholder={t.newPassword}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                  />
                </Field>

                <Field>
                  <FieldLabel htmlFor="confirmPassword">{t.confirmNewPassword}</FieldLabel>
                  <Input
                    id="confirmPassword"
                    type="password"
                    placeholder={t.confirmNewPassword}
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    required
                  />
                </Field>

                <Field>
                  <Button type="submit" disabled={loading || !sessionReady}>
                    {t.updatePassword}
                  </Button>
                  {message ? (
                    <p className="mt-2 text-sm text-center text-zinc-600">{message}</p>
                  ) : null}
                  <FieldDescription className="text-center">
                    {t.needFreshLink} <Link href="/forget-password">{t.requestAnotherResetEmail}</Link>
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
