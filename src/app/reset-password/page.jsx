"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { AuthPageBrand } from "@/components/auth-page-brand";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { useLanguage } from "@/context/LanguageContext";

export default function ResetPasswordPage() {
  const { t } = useLanguage();
  const [phase, setPhase] = useState("preparing");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [completion, setCompletion] = useState(null);
  const link = useRef(null);
  const pending = useRef(false);
  const passwordRef = useRef(null);

  useEffect(() => {
    let active = true;
    // Capture once in memory, then remove all credential material from history.
    // There is intentionally no auth client or token/session fallback here.
    if (!link.current) {
      const url = new URL(window.location.href);
      link.current = {
        code: url.searchParams.get("code"), state: url.searchParams.get("state"),
        invalid: Boolean(url.hash || url.searchParams.has("token_hash") || url.searchParams.has("access_token") ||
          url.searchParams.has("refresh_token") || url.searchParams.has("type") || url.searchParams.has("error")),
      };
      window.history.replaceState(window.history.state, "", "/reset-password");
    }
    async function prepare() {
      try {
        if (link.current.invalid || !link.current.code || !link.current.state) throw new Error("Invalid link");
        const response = await fetch(`/api/auth/recovery?state=${encodeURIComponent(link.current.state)}`, { cache: "no-store" });
        const data = await response.json();
        if (!response.ok || !data.email) throw new Error("Invalid link");
        if (active) { setEmail(data.email); setPhase("ready"); }
      } catch {
        if (active) { setError("invalid_link"); setPhase("invalid"); }
      }
    }
    prepare();
    return () => { active = false; };
  }, []);

  async function handleSubmit(event) {
    event.preventDefault();
    if (pending.current || phase !== "ready") return;
    if (password.length < 8) { setError("password_policy"); passwordRef.current?.focus(); return; }
    if (password !== confirmPassword) { setError("password_mismatch"); return; }
    pending.current = true;
    setPhase("submitting");
    setError("");
    try {
      const response = await fetch("/api/auth/recovery", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "complete", code: link.current.code, state: link.current.state, email, password, confirmPassword }),
      });
      const data = await response.json();
      if (response.ok && data.updated) {
        setCompletion(data);
        setPassword("");
        setConfirmPassword("");
        link.current = { invalid: true };
        setPhase("complete");
      } else {
        setError(data.error || "outcome_unknown");
        // Local validation errors occur before consumption and may be corrected.
        setPhase(["password_policy", "password_mismatch"].includes(data.error) ? "ready" : "invalid");
      }
    } catch {
      setError("outcome_unknown");
      setPhase("invalid");
    } finally {
      pending.current = false;
    }
  }

  const errorMessage = {
    invalid_link: t.recoveryLinkInvalid,
    password_policy: t.recoveryPasswordPolicy,
    password_mismatch: t.passwordsDoNotMatch,
    password_rejected: t.recoveryPasswordRejected,
    outcome_unknown: t.recoveryOutcomeUnknown,
    unavailable: t.recoveryUnavailable,
  }[error] || (error ? t.recoveryLinkInvalid : "");
  const busy = phase === "submitting";

  return (
    <main className="flex min-h-svh w-full items-start justify-center overflow-y-auto bg-zinc-100 px-4 py-6 dark:bg-background sm:items-center md:p-6">
      <div className="flex w-full max-w-sm flex-col gap-6">
        <AuthPageBrand />
        <Card>
          <CardHeader>
            <CardTitle className="text-center">{phase === "complete" ? t.recoveryCompleteTitle : t.resetPasswordTitle}</CardTitle>
            <CardDescription>{t.resetPasswordDescription}</CardDescription>
          </CardHeader>
          <CardContent>
            {phase === "preparing" ? <p role="status" className="text-sm">{t.preparingResetSession}</p> : null}
            {phase === "complete" ? (
              <div className="space-y-4">
                <p role="status" className="text-sm">{t.recoveryComplete}</p>
                {completion.sessionsRevoked === false ? <p role="alert" className="text-sm">{t.recoveryRevocationWarning}</p> : null}
                {completion.preservedSession ? <p className="text-sm">{t.recoveryOtherSessionPreserved}</p> : null}
                <Button asChild className="w-full"><a href={completion.preservedSession ? "/" : "/login"}>{completion.preservedSession ? t.continueToMarketplace : t.backToLogin}</a></Button>
              </div>
            ) : (
              <form onSubmit={handleSubmit} aria-busy={busy} aria-describedby={errorMessage ? "recovery-error" : undefined}>
                <FieldGroup>
                  {phase === "ready" || busy ? <>
                    <p className="text-sm break-words">{t.recoveryForAccount} <strong>{email}</strong></p>
                    <p className="text-sm text-muted-foreground">{t.recoverySessionNotice}</p>
                    <Field>
                      <FieldLabel htmlFor="password">{t.newPassword}</FieldLabel>
                      <Input ref={passwordRef} id="password" type="password" autoComplete="new-password" required minLength={8} maxLength={1024}
                        value={password} onChange={(event) => setPassword(event.target.value)} disabled={busy}
                        aria-describedby="recovery-password-help" aria-invalid={error === "password_policy"} />
                      <FieldDescription id="recovery-password-help">{t.recoveryPasswordPolicy}</FieldDescription>
                    </Field>
                    <Field>
                      <FieldLabel htmlFor="confirmPassword">{t.confirmNewPassword}</FieldLabel>
                      <Input id="confirmPassword" type="password" autoComplete="new-password" required minLength={8} maxLength={1024}
                        value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} disabled={busy}
                        aria-invalid={error === "password_mismatch"} />
                    </Field>
                    <Button type="submit" className="w-full" disabled={busy}>{busy ? t.updatingPassword : t.updatePassword}</Button>
                    <p role="status" className="sr-only">{busy ? t.updatingPassword : ""}</p>
                  </> : null}
                  {errorMessage ? <p id="recovery-error" role="alert" className="text-sm text-red-600 dark:text-red-400">{errorMessage}</p> : null}
                  {phase !== "preparing" ? <FieldDescription className="text-center">
                    <Link href="/forget-password">{t.requestAnotherResetEmail}</Link>
                    {error === "outcome_unknown" ? <><br /><Link href="/login">{t.backToLogin}</Link></> : null}
                  </FieldDescription> : null}
                </FieldGroup>
              </form>
            )}
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
