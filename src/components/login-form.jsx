"use client";
import { useRef, useState } from "react";
import { LoaderCircle } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/utils/supabase/client";
import { cn } from "@/lib/utils";
import { useLanguage } from "@/context/LanguageContext";
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

export function LoginForm({ className, authError = false, ...props }) {
  const { t } = useLanguage();
  const router = useRouter();
  const [formData, setFormData] = useState({ email: "", password: "" });
  const [error, setError] = useState(authError ? t.authLinkInvalid : "");
  const [phase, setPhase] = useState("idle");
  const pending = useRef(false);
  const busy = phase === "submitting" || phase === "navigating";
  const buttonLabel = phase === "submitting" ? t.signingIn : phase === "navigating" ? t.openingMarketplace : t.login;

  function continueToMarketplace() {
    // Recovery action for a stalled client router: deliberately reload from
    // the server without submitting the password a second time.
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.assign("/");
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (pending.current) return;
    pending.current = true;
    setPhase("submitting");
    setError("");
    try {
      const supabase = createClient();
      const { error } = await supabase.auth.signInWithPassword({
        email: formData.email.trim(),
        password: formData.password,
      });
      if (error) {
        setError(error.message);
        setPhase("error");
        pending.current = false;
        return;
      }
      setFormData((current) => ({ ...current, password: "" }));
      setPhase("navigating");
      router.replace("/");
      router.refresh();
    } catch {
      setError(t.signInUnavailable);
      setPhase("error");
      pending.current = false;
    }
  }

  return (
    <div className={cn("flex flex-col gap-6", className)} {...props}>
      <Card>
        <CardHeader>
          <CardTitle className="text-center">{t.loginToYourAccount}</CardTitle>
          <CardDescription>
            {t.loginDescription}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} aria-busy={busy} aria-describedby={error ? "login-error" : undefined}>
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="email">{t.email}</FieldLabel>
                <Input
                  id="email"
                  type="email"
                  autoComplete="email"
                  placeholder="m@example.com"
                  required
                  disabled={busy}
                  value={formData.email}
                  onChange={(e) =>
                    setFormData({ ...formData, email: e.target.value })
                  }
                />
              </Field>

              <Field>
                <div className="flex items-center">
                  <FieldLabel htmlFor="password">{t.password}</FieldLabel>
                  <Link
                    href="/forget-password"
                    className="ml-auto inline-flex min-h-11 items-center text-sm underline-offset-4 hover:underline"
                  >
                    {t.forgotPassword}
                  </Link>
                </div>
                <Input
                  id="password"
                  type="password"
                  autoComplete="current-password"
                  required
                  disabled={busy}
                  value={formData.password}
                  onChange={(e) =>
                    setFormData({ ...formData, password: e.target.value })
                  }
                  aria-invalid={Boolean(error)}
                />
                {error ? <p id="login-error" role="alert" className="text-sm text-red-600 dark:text-red-400">{error}</p> : null}
              </Field>

              <Field>
                <Button type="submit" className="w-full" disabled={busy}>
                  {busy ? <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : null}
                  {buttonLabel}
                </Button>
                <p role="status" aria-live="polite" className="sr-only">{busy ? buttonLabel : ""}</p>
                {phase === "navigating" ? <button type="button" onClick={continueToMarketplace} className="min-h-11 text-center text-sm underline">{t.continueToMarketplace}</button> : null}
                <FieldDescription className="text-center">
                  {t.noAccount} <Link href="/register">{t.signUp}</Link>
                </FieldDescription>
              </Field>
            </FieldGroup>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
