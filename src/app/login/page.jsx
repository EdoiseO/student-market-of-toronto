import { AuthPageBrand } from "@/components/auth-page-brand"
import { LoginForm } from "@/components/login-form"

export default function Page() {
  return (
    <div className="flex h-svh w-full items-center justify-center overflow-hidden bg-zinc-100 p-4 dark:bg-background md:p-6">
      <div className="flex w-full max-w-sm flex-col gap-4">
        <AuthPageBrand />
        <LoginForm />
      </div>
    </div>
  );
}
