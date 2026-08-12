"use client";
import { useState } from "react";
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

export function LoginForm({ className, ...props }) {
  const { t } = useLanguage();
  const router = useRouter();
  const [formData, setFormData] = useState({ email: "", password: "" });
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setSuccess("");

    const supabase = createClient();
    const { error } = await supabase.auth.signInWithPassword({
      email: formData.email,
      password: formData.password,
    });

    if (error) setError(error.message);
    else {
      setSuccess(t.loggedInSuccess);
      router.replace("/");
      router.refresh();
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
          <form onSubmit={handleSubmit}>
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="email">{t.email}</FieldLabel>
                <Input
                  id="email"
                  type="email"
                  autoComplete="email"
                  placeholder="m@example.com"
                  required
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
                  value={formData.password}
                  onChange={(e) =>
                    setFormData({ ...formData, password: e.target.value })
                  }
                  aria-invalid={Boolean(error)}
                />
                {error ? <p role="alert" className="text-sm text-red-600 dark:text-red-400">{error}</p> : null}
              </Field>

              <Field>
                <Button type="submit" className="w-full">{t.login}</Button>
                {success && (
                  <p role="status" className="text-sm text-green-600 dark:text-green-400">{success}</p>
                )}
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
