import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { CreateListingForm } from "@/components/create-listing-form";
import { createClient } from "@/utils/supabase/server";

export default async function CreateListingPage() {
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  return <CreateListingForm />;
}
