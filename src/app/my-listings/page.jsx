"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/utils/supabase/client";

export default function MyListingsPage() {
  const [listings, setListings] = useState([]);
  const [loading, setLoading] = useState(true);

  const supabase = createClient();

  useEffect(() => {
    async function fetchMyListings() {
      const { data: userData } = await supabase.auth.getUser();
      const user = userData?.user;

      if (!user) {
        setListings([]);
        setLoading(false);
        return;
      }

      const { data, error } = await supabase
        .from("listings")
        .select("*")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false });

      if (error) {
        console.error("Error fetching my listings:", error);
      } else {
        setListings(data || []);
      }

      setLoading(false);
    }

    fetchMyListings();
  }, [supabase]);

  return (
    <main className="min-h-screen bg-zinc-100 p-6 md:p-10">
      <div className="mx-auto max-w-6xl">
        <div className="mb-8 flex items-center justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold text-zinc-900">My Listings</h1>
            <p className="mt-2 text-sm text-zinc-600">
              View and manage the listings you created.
            </p>
          </div>

          <div className="flex items-center gap-3">
            <Link
              href="/listings/create"
              className="rounded-md bg-black px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800"
            >
              Create Listing
            </Link>

            <Link
              href="/listings"
              className="rounded-md border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
            >
              Back to Listings
            </Link>
          </div>
        </div>

        {loading ? (
          <p className="text-sm text-zinc-600">Loading your listings...</p>
        ) : listings.length === 0 ? (
          <div className="rounded-xl border border-dashed border-zinc-300 bg-white p-8 text-center text-zinc-600">
            You have not created any listings yet.
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {listings.map((listing) => (
              <div
                key={listing.id}
                className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm"
              >
                <div className="mb-4 flex items-start justify-between gap-3">
                  <h2 className="text-lg font-semibold text-zinc-900">
                    {listing.title}
                  </h2>

                  <span
                    className={`rounded-full px-2 py-1 text-xs font-medium ${
                      listing.status === "Available"
                        ? "bg-green-100 text-green-700"
                        : "bg-red-100 text-red-700"
                    }`}
                  >
                    {listing.status}
                  </span>
                </div>

                <p className="mb-4 text-2xl font-bold text-zinc-900">
                  ${listing.price}
                </p>

                <div className="space-y-1 text-sm text-zinc-600">
                  <p>
                    <span className="font-medium text-zinc-800">Category:</span>{" "}
                    {listing.category}
                  </p>
                  <p>
                    <span className="font-medium text-zinc-800">
                      Condition:
                    </span>{" "}
                    {listing.condition}
                  </p>
                  <p>
                    <span className="font-medium text-zinc-800">Location:</span>{" "}
                    {listing.location}
                  </p>
                </div>

                <div className="mt-5 flex gap-2">
                  <Link
                    href={`/listings/${listing.id}`}
                    className="flex-1 rounded-md bg-black px-4 py-2 text-center text-sm font-medium text-white hover:bg-zinc-800"
                  >
                    View
                  </Link>

                  <button
                    type="button"
                    className="flex-1 rounded-md border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
                  >
                    Edit
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
