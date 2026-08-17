import { AccountStandingSkeleton } from "@/components/skeletons/account-standing-skeleton";

export default function AccountStandingLoading() {
  return (
    <main
      aria-busy="true"
      aria-label="Loading account standing"
      className="min-h-screen bg-zinc-100 px-3 py-3 dark:bg-background sm:px-4 md:p-5 lg:p-8"
    >
      <div className="mx-auto w-full max-w-6xl">
        <AccountStandingSkeleton />
      </div>
    </main>
  );
}
