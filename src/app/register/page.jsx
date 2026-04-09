import { RegisterForm } from "@/components/register-form"

export default function Page() {
  return (
    <div className="flex min-h-svh w-full items-center justify-center bg-zinc-100 p-6 dark:bg-background md:p-10">
      <div className="w-full max-w-sm">
        <RegisterForm />
      </div>
    </div>
  );
}
