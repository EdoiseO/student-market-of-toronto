"use client";
import { useRef, useState } from "react";
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
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { focusFirstInvalidField } from "@/lib/focus-first-invalid-field";
import {
  WRITE_FIELD_ERROR_CODES,
  validateProfileIdentity,
} from "@/lib/write-field-contracts.mjs";

export function RegisterForm({ className, ...props }) {
  const { t } = useLanguage();
  const formRef = useRef(null);
  const [form, setForm] = useState({
    firstName: "",
    lastName: "",
    email: "",
    password: "",
    confirmPassword: "",
    school: "",
  });
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState({});
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
    setFieldErrors((currentErrors) => {
      if (!currentErrors[name]) {
        return currentErrors;
      }

      const nextErrors = { ...currentErrors };
      delete nextErrors[name];
      return nextErrors;
    });
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
    const identity = validateProfileIdentity(form);
    const nextFieldErrors = { ...identity.errors };

    if (!email || !isValidTorontoSchoolEmail(email) || !school) {
      nextFieldErrors.email = "invalid";
    }

    if (!form.password) {
      nextFieldErrors.password = WRITE_FIELD_ERROR_CODES.required;
    }

    if (!form.confirmPassword || form.password !== form.confirmPassword) {
      nextFieldErrors.confirmPassword = form.confirmPassword
        ? "mismatch"
        : WRITE_FIELD_ERROR_CODES.required;
    }

    if (Object.keys(nextFieldErrors).length > 0) {
      setFieldErrors(nextFieldErrors);
      focusFirstInvalidField(formRef.current);
      return;
    }

    setFieldErrors({});

    const supabase = createClient();

    const { error } = await supabase.auth.signUp({
      email,
      password: form.password,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback`,
        data: {
          first_name: identity.values.firstName,
          last_name: identity.values.lastName,
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
          <form ref={formRef} onSubmit={handleSubmit} noValidate>
            <FieldGroup>
              <p className="text-xs text-muted-foreground">{t.requiredFieldsLegend}</p>
              <Field data-invalid={Boolean(fieldErrors.firstName)}>
                <FieldLabel htmlFor="firstName">
                  {t.firstName} <span aria-hidden="true">*</span>
                </FieldLabel>
                <Input
                  id="firstName"
                  type="text"
                  autoComplete="given-name"
                  placeholder="John"
                  required
                  aria-required="true"
                  value={form.firstName}
                  onChange={(e) => updateField("firstName", e.target.value)}
                  aria-invalid={Boolean(fieldErrors.firstName)}
                  aria-describedby={fieldErrors.firstName ? "firstName-error" : undefined}
                />
                <FieldError id="firstName-error">
                  {fieldErrors.firstName === WRITE_FIELD_ERROR_CODES.tooLong
                    ? t.profileNameLengthError
                    : fieldErrors.firstName
                      ? t.profileFirstNameRequired
                      : null}
                </FieldError>
              </Field>

              <Field data-invalid={Boolean(fieldErrors.lastName)}>
                <FieldLabel htmlFor="lastName">
                  {t.lastName} <span aria-hidden="true">*</span>
                </FieldLabel>
                <Input
                  id="lastName"
                  type="text"
                  autoComplete="family-name"
                  placeholder="Doe"
                  required
                  aria-required="true"
                  value={form.lastName}
                  onChange={(e) => updateField("lastName", e.target.value)}
                  aria-invalid={Boolean(fieldErrors.lastName)}
                  aria-describedby={fieldErrors.lastName ? "lastName-error" : undefined}
                />
                <FieldError id="lastName-error">
                  {fieldErrors.lastName === WRITE_FIELD_ERROR_CODES.tooLong
                    ? t.profileNameLengthError
                    : fieldErrors.lastName
                      ? t.profileLastNameRequired
                      : null}
                </FieldError>
              </Field>

              <Field data-invalid={Boolean(fieldErrors.email || schoolEmailError)}>
                <FieldLabel htmlFor="email">
                  {t.schoolEmail} <span aria-hidden="true">*</span>
                </FieldLabel>
                <Input
                  id="email"
                  type="email"
                  autoComplete="email"
                  placeholder="john.doe@mail.utoronto.ca"
                  required
                  aria-required="true"
                  value={form.email}
                  onChange={(e) => updateField("email", e.target.value)}
                  aria-invalid={Boolean(fieldErrors.email || schoolEmailError)}
                  aria-describedby={fieldErrors.email || schoolEmailError ? "email-error" : undefined}
                />
                <FieldError id="email-error">
                  {fieldErrors.email ? getSchoolEmailError(form.email) : schoolEmailError}
                </FieldError>
              </Field>

              <Field data-invalid={Boolean(fieldErrors.password || passwordBackendError)}>
                <FieldLabel htmlFor="password">
                  {t.password} <span aria-hidden="true">*</span>
                </FieldLabel>
                <Input
                  id="password"
                  type="password"
                  autoComplete="new-password"
                  required
                  aria-required="true"
                  value={form.password}
                  onChange={(e) => updateField("password", e.target.value)}
                  aria-invalid={Boolean(fieldErrors.password || passwordBackendError)}
                  aria-describedby={fieldErrors.password || passwordBackendError ? "password-error" : undefined}
                />
                <FieldError id="password-error">
                  {fieldErrors.password ? t.registrationPasswordRequired : passwordBackendError}
                </FieldError>
              </Field>

              <Field data-invalid={Boolean(fieldErrors.confirmPassword || passwordMismatchError)}>
                <FieldLabel htmlFor="confirmPassword">
                  {t.confirmPassword} <span aria-hidden="true">*</span>
                </FieldLabel>
                <Input
                  id="confirmPassword"
                  type="password"
                  autoComplete="new-password"
                  required
                  aria-required="true"
                  value={form.confirmPassword}
                  onChange={(e) =>
                    updateField("confirmPassword", e.target.value)
                  }
                  aria-invalid={Boolean(fieldErrors.confirmPassword || passwordMismatchError)}
                  aria-describedby={fieldErrors.confirmPassword || passwordMismatchError ? "confirmPassword-error" : undefined}
                />
                <FieldError id="confirmPassword-error">
                  {fieldErrors.confirmPassword === WRITE_FIELD_ERROR_CODES.required
                    ? t.registrationConfirmPasswordRequired
                    : fieldErrors.confirmPassword || passwordMismatchError
                      ? t.passwordsDoNotMatch
                      : null}
                </FieldError>
              </Field>

              <Field>
                <FieldLabel htmlFor="school">{t.schoolCampus}</FieldLabel>
                <Input
                  id="school"
                  type="text"
                  placeholder={t.schoolAutoFilledPlaceholder}
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
