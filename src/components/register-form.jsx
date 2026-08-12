"use client";
import { useState } from "react";
import Link from "next/link";
import { createClient } from "@/utils/supabase/client";
import { cn } from "@/lib/utils";
import { useLanguage } from "@/context/LanguageContext";
import {
  getTorontoSchoolNameFromEmail,
  isValidTorontoSchoolEmail,
  normalizeEmail,
} from "@/lib/school-email";
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

export function RegisterForm({ className, ...props }) {
  const { t } = useLanguage();
  const [form, setForm] = useState({
    firstName: "",
    lastName: "",
    email: "",
    password: "",
    confirmPassword: "",
    school: "",
  });
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const normalizedEmail = normalizeEmail(form.email);
  const showSchoolEmailHint = normalizedEmail.length > 0;
  const getSchoolEmailError = (email) => {
    if (!normalizeEmail(email)) {
      return t.enterTorontoSchoolEmail;
    }

    if (!isValidTorontoSchoolEmail(email)) {
      return t.validTorontoSchoolEmail;
    }

    return "";
  };
  const schoolEmailError = showSchoolEmailHint
    ? getSchoolEmailError(form.email)
    : "";
  const passwordMismatchError = error === t.passwordsDoNotMatch;
  const passwordBackendError = error && !passwordMismatchError && /password/i.test(error)
    ? error
    : "";
  const formError = error && !passwordMismatchError && !passwordBackendError && error !== schoolEmailError
    ? error
    : "";

  function updateField(name, value) {
    setForm((currentForm) => {
      if (name === "email") {
        return {
          ...currentForm,
          email: value,
          school: getTorontoSchoolNameFromEmail(value),
        };
      }

      return {
        ...currentForm,
        [name]: value,
      };
    });
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setSuccess("");
    const email = normalizeEmail(form.email);
    const school = getTorontoSchoolNameFromEmail(email);

    if (form.password !== form.confirmPassword) {
      setError(t.passwordsDoNotMatch);
      return;
    }

    if (!isValidTorontoSchoolEmail(email) || !school) {
      setError(getSchoolEmailError(email));
      return;
    }

    const supabase = createClient();

    const { error } = await supabase.auth.signUp({
      email,
      password: form.password,
      options: {
        data: {
          first_name: form.firstName,
          last_name: form.lastName,
          school,
        },
      },
    });

    if (error) {
      setError(error.message);
      return;
    }

    setSuccess(t.accountCreatedSuccess);
  }

  return (
    <div className={cn("flex flex-col gap-6", className)} {...props}>
      <Card>
        <CardHeader>
          <CardTitle className="text-center">{t.createAccount}</CardTitle>
          <CardDescription>{t.registerDescription}</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit}>
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="firstName">{t.firstName}</FieldLabel>
                <Input
                  id="firstName"
                  type="text"
                  autoComplete="given-name"
                  placeholder="John"
                  required
                  value={form.firstName}
                  onChange={(e) => updateField("firstName", e.target.value)}
                />
              </Field>

              <Field>
                <FieldLabel htmlFor="lastName">{t.lastName}</FieldLabel>
                <Input
                  id="lastName"
                  type="text"
                  autoComplete="family-name"
                  placeholder="Doe"
                  required
                  value={form.lastName}
                  onChange={(e) => updateField("lastName", e.target.value)}
                />
              </Field>

              <Field>
                <FieldLabel htmlFor="email">{t.schoolEmail}</FieldLabel>
                <Input
                  id="email"
                  type="email"
                  autoComplete="email"
                  placeholder="john.doe@mail.utoronto.ca"
                  required
                  value={form.email}
                  onChange={(e) => updateField("email", e.target.value)}
                  aria-invalid={Boolean(schoolEmailError)}
                />
                {schoolEmailError && (
                  <p role="alert" className="text-sm text-red-600 dark:text-red-400">{schoolEmailError}</p>
                )}
              </Field>

              <Field>
                <FieldLabel htmlFor="password">{t.password}</FieldLabel>
                <Input
                  id="password"
                  type="password"
                  autoComplete="new-password"
                  required
                  value={form.password}
                  onChange={(e) => updateField("password", e.target.value)}
                  aria-invalid={Boolean(passwordBackendError)}
                />
                {passwordBackendError ? (
                  <p role="alert" className="text-sm text-red-600 dark:text-red-400">{passwordBackendError}</p>
                ) : null}
              </Field>

              <Field>
                <FieldLabel htmlFor="confirmPassword">
                  {t.confirmPassword}
                </FieldLabel>
                <Input
                  id="confirmPassword"
                  type="password"
                  autoComplete="new-password"
                  required
                  value={form.confirmPassword}
                  onChange={(e) =>
                    updateField("confirmPassword", e.target.value)
                  }
                  aria-invalid={passwordMismatchError}
                />
                {passwordMismatchError ? (
                  <p role="alert" className="text-sm text-red-600 dark:text-red-400">{error}</p>
                ) : null}
              </Field>

              <Field>
                <FieldLabel htmlFor="school">{t.schoolCampus}</FieldLabel>
                <Input
                  id="school"
                  type="text"
                  placeholder={t.schoolAutoFilledPlaceholder}
                  required
                  value={form.school}
                  readOnly
                />
                <FieldDescription>
                  {t.schoolAutoFilledDescription}
                </FieldDescription>
              </Field>

              <Field>
                <Button type="submit" className="w-full">{t.signUp}</Button>
                {success && (
                  <p role="status" className="text-sm text-green-600 dark:text-green-400">{success}</p>
                )}
                {formError ? (
                  <p role="alert" className="text-sm text-red-600 dark:text-red-400">{formError}</p>
                ) : null}
                <FieldDescription className="text-center">
                  {t.alreadyHaveAccount} <Link href="/login">{t.login}</Link>
                </FieldDescription>
              </Field>
            </FieldGroup>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
