import { cookies } from "next/headers";

import { AuthPageSkeleton } from "@/components/skeletons/auth-page-skeleton";
import { translations } from "@/lib/translations";

export default async function RegisterLoading() {
  const cookieStore = await cookies();
  const language = cookieStore.get("language")?.value === "fr" ? "fr" : "en";
  const t = translations[language] || translations.en;

  return <AuthPageSkeleton fieldCount={6} width="md" label={t.loadingAccountForm} />;
}
