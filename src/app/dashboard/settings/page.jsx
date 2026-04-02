import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { DashboardSettingsContent } from "@/components/dashboard-settings-content";
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
        <DashboardSettingsContent userEmail={user.email ?? ""} />
      </div>
    </main>
  );
}
