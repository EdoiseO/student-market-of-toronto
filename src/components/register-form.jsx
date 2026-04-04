"use client";
import { useState } from "react";
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
                  placeholder="john.doe@mail.utoronto.ca"
                  required
                  value={form.email}
                  onChange={(e) => updateField("email", e.target.value)}
                />
                {schoolEmailError && (
                  <p className="text-sm text-red-600">{schoolEmailError}</p>
                )}
              </Field>

              <Field>
                <FieldLabel htmlFor="password">{t.password}</FieldLabel>
                <Input
                  id="password"
                  type="password"
                  required
                  value={form.password}
                  onChange={(e) => updateField("password", e.target.value)}
                />
              </Field>

              <Field>
                <FieldLabel htmlFor="confirmPassword">
                  {t.confirmPassword}
                </FieldLabel>
                <Input
                  id="confirmPassword"
                  type="password"
                  required
                  value={form.confirmPassword}
                  onChange={(e) =>
                    updateField("confirmPassword", e.target.value)
                  }
                />
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
                <Button type="submit">{t.signUp}</Button>
                {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
                {success && (
                  <p className="mt-2 text-sm text-green-600">{success}</p>
                )}
                <FieldDescription className="text-center">
                  {t.alreadyHaveAccount} <a href="/login">{t.login}</a>
                </FieldDescription>
              </Field>
            </FieldGroup>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
