import Link from "next/link";
import { createClient } from "@/utils/supabase/client";

export default async function ListingDetailPage({ params }) {
  const supabase = createClient();
  const { id } = await params;

  const { data: listing, error } = await supabase
    .from("listings")
    .select("*")
    .eq("id", id)
    .single();

  if (error || !listing) {
    return (
      <main className="min-h-screen bg-zinc-100 p-6 md:p-10">
        <div className="mx-auto max-w-3xl rounded-xl border border-zinc-200 bg-white p-8 shadow-sm">
          <h1 className="text-2xl font-bold text-zinc-900">Listing not found</h1>
          <p className="mt-2 text-sm text-zinc-600">
            The listing you are looking for does not exist or could not be loaded.
          </p>
          <Link
            href="/listings"
            className="mt-6 inline-block rounded-md bg-black px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800"
          >
            Back to Listings
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-zinc-100 p-6 md:p-10">
      <div className="mx-auto max-w-3xl">
        <div className="mb-6 flex items-center justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold text-zinc-900">{listing.title}</h1>
            <p className="mt-2 text-sm text-zinc-600">Full listing details</p>
          </div>

          <Link
            href="/listings"
            className="rounded-md border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
          >
            Back to Listings
          </Link>
        </div>

        <div className="rounded-xl border border-zinc-200 bg-white p-8 shadow-sm">
          <div className="mb-6 flex items-start justify-between gap-4">
            <div>
              <h2 className="text-2xl font-semibold text-zinc-900">{listing.title}</h2>
              <p className="mt-2 text-3xl font-bold text-zinc-900">${listing.price}</p>
            </div>

            <span
              className={`rounded-full px-3 py-1 text-sm font-medium ${
                listing.status === "Available"
                  ? "bg-green-100 text-green-700"
                  : "bg-red-100 text-red-700"
              }`}
            >
              {listing.status}
            </span>
          </div>

          <div className="space-y-3 text-sm text-zinc-700">
            <p><span className="font-medium text-zinc-900">Category:</span> {listing.category || "N/A"}</p>
            <p><span className="font-medium text-zinc-900">Condition:</span> {listing.condition || "N/A"}</p>
            <p><span className="font-medium text-zinc-900">Location:</span> {listing.location || "N/A"}</p>
            <p><span className="font-medium text-zinc-900">Description:</span> {listing.description || "No description provided."}</p>
          </div>
        </div>
      </div>
    </main>
  );
}