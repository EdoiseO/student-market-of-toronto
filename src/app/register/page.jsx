import { RegisterForm } from "@/components/register-form"
import { ThemeToggle } from "@/components/theme-toggle";

export default function Page() {
  return (
    <div className="relative flex min-h-svh w-full items-center justify-center bg-zinc-100 p-6 dark:bg-zinc-950 md:p-10">
      <div className="absolute right-6 top-6">
        <ThemeToggle />
      </div>
      <div className="w-full max-w-sm">
        <RegisterForm />
      </div>
    </div>
  );
}
