"use client";
export const dynamic = "force-dynamic";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { createClient } from "@/utils/supabase/client";

export default function ResetPasswordPage() {
  const supabase = useMemo(() => createClient(), []);
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
        setMessage(
          "For security reasons, this link format is not supported. Please request a new reset email. (Developers: Update the Supabase 'Reset Password' email template to use {{ .TokenHash }} instead of {{ .ConfirmationURL }})."
        );
        setSessionReady(false);
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
        window.location.href = "/login";
      }, 1500);
    }
  }

  if (loading) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-zinc-100">
        <div className="bg-white p-8 rounded-xl shadow-md w-full max-w-md text-center">
          <p className="text-sm text-zinc-600">Preparing reset session...</p>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen flex items-center justify-center bg-zinc-100">
      <form
        onSubmit={handleSubmit}
        className="bg-white p-8 rounded-xl shadow-md w-full max-w-md"
      >
        <h1 className="text-2xl font-bold mb-4">Reset Password</h1>

        <input
          type="password"
          placeholder="New password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="w-full border px-4 py-2 rounded-md mb-4"
          required
        />

        <input
          type="password"
          placeholder="Confirm new password"
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          className="w-full border px-4 py-2 rounded-md mb-4"
          required
        />

        <button
          type="submit"
          disabled={loading || !sessionReady}
          className="w-full bg-black text-white py-2 rounded-md disabled:opacity-60"
        >
          Update Password
        </button>

        {message && (
          <p className="mt-4 text-sm text-center text-zinc-600">{message}</p>
        )}
      </form>
    </main>
  );
}