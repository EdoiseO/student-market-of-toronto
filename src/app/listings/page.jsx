"use client";
import { useEffect, useState } from "react";
import { createClient } from "@/utils/supabase/client";
import Link from "next/link";

const mockListings = [
  {
    id: 1,
    title: "Calculus Textbook",
    price: 40,
    category: "Books",
    condition: "Used",
    location: "Toronto",
    status: "Available",
  },
  {
    id: 2,
    title: "MacBook Air M1",
    price: 750,
    category: "Electronics",
    condition: "Like New",
    location: "North York",
    status: "Available",
  },
  {
    id: 3,
    title: "Desk Chair",
    price: 60,
    category: "Furniture",
    condition: "Good",
    location: "Scarborough",
    status: "Sold",
  },
  {
    id: 4,
    title: "TI-84 Calculator",
    price: 55,
    category: "School Supplies",
    condition: "Used",
    location: "Etobicoke",
    status: "Available",
  },
];

export default function ListingsPage() {
  const [listings, setListings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    async function fetchListings() {
      const supabase = createClient();

      const { data, error } = await supabase
        .from("listings")
        .select("*")
        .eq("status", "Available")
        .order("created_at", { ascending: false });

      if (error) {
        console.log(error);
        setError("Could not load listings right now.");
        setListings(mockListings);
      } else if (!data || data.length === 0) {
        setListings([]);
      } else {
        setListings(data);
      }

      setLoading(false);
    }

    fetchListings();
  }, []);

  return (
    <main className="min-h-screen bg-zinc-100 p-6 md:p-10">
      <div className="mx-auto max-w-6xl">
        <div className="mb-8 flex items-center justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold text-zinc-900">Browse Listings</h1>
            <p className="mt-2 text-sm text-zinc-600">
              Browse items posted by students across Toronto.
            </p>
          </div>

          <a
            href="/"
            className="rounded-md border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
          >
            Back Home
          </a>
        </div>

        {loading && (
          <p className="mb-4 text-sm text-zinc-600">Loading listings...</p>
        )}

        {error && (
          <p className="mb-4 text-sm text-red-600">{error}</p>
        )}

        {!loading && listings.length === 0 && !error && (
          <div className="rounded-xl border border-dashed border-zinc-300 bg-white p-8 text-center text-zinc-600">
            No listings available yet.
          </div>
        )}

        {listings.length > 0 && (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {listings.map((listing) => (
              <div
                key={listing.id}
                className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm"
              >
                <div className="mb-4 flex items-start justify-between gap-3">
                  <h2 className="text-lg font-semibold text-zinc-900">{listing.title}</h2>
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

                <p className="mb-4 text-2xl font-bold text-zinc-900">${listing.price}</p>

                <div className="space-y-1 text-sm text-zinc-600">
                  <p>
                    <span className="font-medium text-zinc-800">Category:</span> {listing.category}
                  </p>
                  <p>
                    <span className="font-medium text-zinc-800">Condition:</span> {listing.condition}
                  </p>
                  <p>
                    <span className="font-medium text-zinc-800">Location:</span> {listing.location}
                  </p>
                </div>

                <Link
                  href={`/listings/${listing.id}`}
                  className="mt-5 block w-full rounded-md bg-black px-4 py-2 text-center text-sm font-medium text-white hover:bg-zinc-800"
                >
                  View Details
                </Link>
              </div>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}