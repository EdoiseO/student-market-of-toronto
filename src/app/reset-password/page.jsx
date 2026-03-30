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
import { Input } from "@/components/ui/input";
import { createClient } from "@/utils/supabase/client";

export default function ResetPasswordPage() {
  const supabase = useMemo(() => createClient(), []);
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
        setMessage("Invalid or expired reset link.");
        setSessionReady(false);
      }

      setLoading(false);
    }

    setResetSession();
  }, [searchParams, supabase]);

  async function handleSubmit(e) {
    e.preventDefault();

    if (loading || !sessionReady) {
      setMessage("Reset session is not ready. Please open the reset link from your email again.");
      return;
    }

    if (password !== confirmPassword) {
      setMessage("Passwords do not match.");
      return;
    }

    const { error } = await supabase.auth.updateUser({
      password: password,
    });

    if (error) {
      setMessage(error.message);
    } else {
      setMessage("Password updated successfully. Redirecting to login...");
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
              <p className="text-sm text-zinc-600">Preparing reset session...</p>
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
            <CardTitle className="text-center">Reset Password</CardTitle>
            <CardDescription>
              Enter and confirm your new password.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit}>
              <FieldGroup>
                <Field>
                  <FieldLabel htmlFor="password">New Password</FieldLabel>
                  <Input
                    id="password"
                    type="password"
                    placeholder="New password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                  />
                </Field>

                <Field>
                  <FieldLabel htmlFor="confirmPassword">Confirm Password</FieldLabel>
                  <Input
                    id="confirmPassword"
                    type="password"
                    placeholder="Confirm new password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    required
                  />
                </Field>

                <Field>
                  <Button type="submit" disabled={loading || !sessionReady}>
                    Update Password
                  </Button>
                  {message ? (
                    <p className="mt-2 text-sm text-center text-zinc-600">{message}</p>
                  ) : null}
                  <FieldDescription className="text-center">
                    Need a fresh link? <Link href="/forget-password">Request another reset email</Link>
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
