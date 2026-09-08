import { AuthPageBrand } from "@/components/auth-page-brand"
import { LoginForm } from "@/components/login-form"

export default async function Page({ searchParams }) {
  const params = await searchParams;
  return (
    <main className="flex min-h-svh w-full items-start justify-center overflow-y-auto bg-zinc-100 px-4 py-6 dark:bg-background sm:items-center md:p-6">
      <div className="flex w-full max-w-sm flex-col gap-6">
        <AuthPageBrand />
        <LoginForm authError={params?.auth_error === "invalid_link"} />
      </div>
    </main>
  );
}
