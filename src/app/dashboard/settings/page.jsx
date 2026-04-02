import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { createClient } from "@/utils/supabase/server";

export default async function DashboardSettingsPage() {
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  return (
    <main className="min-h-screen bg-zinc-100 p-6 md:p-8">
      <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-8">
        <section className="rounded-3xl bg-white p-8 shadow-sm ring-1 ring-zinc-200">
          <h1 className="text-4xl font-bold tracking-tight text-zinc-950">Settings</h1>
          <p className="mt-3 max-w-3xl text-base text-zinc-600">
            System settings will live here. This page is ready so the new sidebar entry has a
            real destination while we build out public profile controls and account preferences.
          </p>
        </section>

        <Card className="rounded-3xl bg-white py-0 shadow-sm ring-zinc-200">
          <CardHeader className="border-b border-zinc-200 px-6 py-6">
            <CardTitle className="text-2xl text-zinc-950">Planned settings</CardTitle>
            <CardDescription>
              These settings are not implemented yet, so this section stays descriptive instead of
              pretending they work today.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 px-6 py-8">
            <div className="rounded-2xl border border-zinc-200 bg-zinc-50 px-4 py-4">
              <p className="text-sm font-medium text-zinc-950">Public profile visibility</p>
              <p className="mt-1 text-sm text-zinc-500">
                Manage whether your public profile can be viewed by other students.
              </p>
            </div>
            <div className="rounded-2xl border border-zinc-200 bg-zinc-50 px-4 py-4">
              <p className="text-sm font-medium text-zinc-950">Account preferences</p>
              <p className="mt-1 text-sm text-zinc-500">
                Future account-level controls like profile behavior and system settings will land
                here.
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
