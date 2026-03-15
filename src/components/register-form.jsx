"use client";
import { useState } from "react";
import { createClient } from "@/utils/supabase/client";
import { cn } from "@/lib/utils";
import {
  getTorontoSchoolEmailError,
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

export function RegisterForm({
  className,
  ...props
}) {
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
  const schoolEmailError = showSchoolEmailHint
    ? getTorontoSchoolEmailError(form.email)
    : "";

  function updateField(name, value) {
    setForm((currentForm) => ({
      ...currentForm,
      [name]: value,
    }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setSuccess("");
    const email = normalizeEmail(form.email);

    // basic checks
    if (form.password !== form.confirmPassword) {
      setError("Passwords do not match.");
      return;
    }
    if (!isValidTorontoSchoolEmail(email)) {
      setError(getTorontoSchoolEmailError(email));
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
          school: form.school,
        },
      },
    });

    if (error) setError(error.message);
    else setSuccess("Account created. Check your email to verify.");
  }

  return (
    <div className={cn("flex flex-col gap-6", className)} {...props}>
      <Card>
        <CardHeader>
          <CardTitle className="text-center">Create an account</CardTitle>
          <CardDescription>
            Fill in your details below to sign up
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit}>
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="firstName">First Name</FieldLabel>
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
                <FieldLabel htmlFor="lastName">Last Name</FieldLabel>
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
                <FieldLabel htmlFor="email">School Email (enter your Toronto school email)</FieldLabel>
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
                <FieldLabel htmlFor="password">Password</FieldLabel>
                <Input
                  id="password"
                  type="password"
                  required
                  value={form.password}
                  onChange={(e) => updateField("password", e.target.value)}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="confirmPassword">Confirm Password</FieldLabel>
                <Input
                  id="confirmPassword"
                  type="password"
                  required
                  value={form.confirmPassword}
                  onChange={(e) => updateField("confirmPassword", e.target.value)}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="school">School / Campus</FieldLabel>
                <Input
                  id="school"
                  type="text"
                  placeholder="e.g. University of Toronto"
                  required
                  value={form.school}
                  onChange={(e) => updateField("school", e.target.value)}
                />
              </Field>
              <Field>
                <Button type="submit">Sign Up</Button>
                {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
                {success && <p className="mt-2 text-sm text-green-600">{success}</p>}
                <FieldDescription className="text-center">
                  Already have an account? <a href="/login">Login</a>
                </FieldDescription>
              </Field>
            </FieldGroup>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
