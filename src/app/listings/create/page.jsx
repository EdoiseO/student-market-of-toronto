

"use client";

import { useState } from "react";
import Link from "next/link";
import { createClient } from "@/utils/supabase/client";

export default function CreateListingPage() {
  const [formData, setFormData] = useState({
    title: "",
    description: "",
    price: "",
    category: "",
    condition: "",
    location: "",
    status: "Available",
    imageName: "",
  });

  const supabase = createClient();

  function handleChange(e) {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  }

  function handleFileChange(e) {
    const file = e.target.files?.[0];
    setFormData((prev) => ({
      ...prev,
      imageName: file ? file.name : "",
    }));
  }

  async function handleSubmit(e) {
    e.preventDefault();

    const { error } = await supabase.from("listings").insert([
      {
        title: formData.title,
        description: formData.description,
        price: Number(formData.price),
        category: formData.category,
        condition: formData.condition,
        location: formData.location,
        status: formData.status,
      },
    ]);

    if (error) {
      console.error("Error creating listing:", error);
      alert(error.message);

      return;
    }

    alert("Listing created successfully!");
    window.location.href = "/listings";
  }

  return (
    <main className="min-h-screen bg-zinc-100 p-6 md:p-10">
      <div className="mx-auto max-w-3xl">
        <div className="mb-6 flex items-center justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold text-zinc-900">Create Listing</h1>
            <p className="mt-2 text-sm text-zinc-600">
              Fill in the form below to post a new listing.
            </p>
          </div>

          <Link
            href="/listings"
            className="rounded-md border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
          >
            Back to Listings
          </Link>
        </div>

        <div className="rounded-xl border border-zinc-200 bg-white p-8 shadow-sm">
          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label className="mb-2 block text-sm font-medium text-zinc-900">
                Title
              </label>
              <input
                type="text"
                name="title"
                value={formData.title}
                onChange={handleChange}
                placeholder="e.g. PS5"
                className="w-full rounded-md border border-zinc-300 px-4 py-2 text-sm outline-none focus:border-zinc-500"
                required
              />
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium text-zinc-900">
                Description
              </label>
              <textarea
                name="description"
                value={formData.description}
                onChange={handleChange}
                placeholder="Describe the item"
                rows={4}
                className="w-full rounded-md border border-zinc-300 px-4 py-2 text-sm outline-none focus:border-zinc-500"
              />
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <label className="mb-2 block text-sm font-medium text-zinc-900">
                  Price
                </label>
                <input
                  type="number"
                  name="price"
                  value={formData.price}
                  onChange={handleChange}
                  placeholder="e.g. 700"
                  className="w-full rounded-md border border-zinc-300 px-4 py-2 text-sm outline-none focus:border-zinc-500"
                  required
                />
              </div>

              <div>
                <label className="mb-2 block text-sm font-medium text-zinc-900">
                  Category
                </label>
                <select
                  name="category"
                  value={formData.category}
                  onChange={handleChange}
                  className="w-full rounded-md border border-zinc-300 px-4 py-2 text-sm outline-none focus:border-zinc-500"
                  required
                >
                  <option value="">Select category</option>
                  <option value="Electronics">Electronics</option>
                  <option value="Books">Books</option>
                  <option value="Furniture">Furniture</option>
                  <option value="School Supplies">School Supplies</option>
                  <option value="Other">Other</option>
                </select>
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <label className="mb-2 block text-sm font-medium text-zinc-900">
                  Condition
                </label>
                <select
                  name="condition"
                  value={formData.condition}
                  onChange={handleChange}
                  className="w-full rounded-md border border-zinc-300 px-4 py-2 text-sm outline-none focus:border-zinc-500"
                  required
                >
                  <option value="">Select condition</option>
                  <option value="New">New</option>
                  <option value="Like New">Like New</option>
                  <option value="Used">Used</option>
                  <option value="Good">Good</option>
                </select>
              </div>

              <div>
                <label className="mb-2 block text-sm font-medium text-zinc-900">
                  Location
                </label>
                <input
                  type="text"
                  name="location"
                  value={formData.location}
                  onChange={handleChange}
                  placeholder="e.g. Toronto"
                  className="w-full rounded-md border border-zinc-300 px-4 py-2 text-sm outline-none focus:border-zinc-500"
                  required
                />
              </div>
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium text-zinc-900">
                Status
              </label>
              <select
                name="status"
                value={formData.status}
                onChange={handleChange}
                className="w-full rounded-md border border-zinc-300 px-4 py-2 text-sm outline-none focus:border-zinc-500"
              >
                <option value="Available">Available</option>
                <option value="Sold">Sold</option>
              </select>
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium text-zinc-900">
                Listing Image
              </label>

              <label className="flex cursor-pointer items-center justify-between rounded-md border border-zinc-300 bg-white px-4 py-3 text-sm text-zinc-700 hover:bg-zinc-50">
                <span>{formData.imageName || "Choose an image"}</span>
                <span className="rounded-md bg-black px-3 py-1 text-xs font-medium text-white">
                  Upload
                </span>
                <input
                  type="file"
                  accept="image/*"
                  onChange={handleFileChange}
                  className="hidden"
                />
              </label>

              <p className="mt-2 text-xs text-zinc-500">
                Image upload UI is ready. Storage connection will be added next.
              </p>
            </div>

            <button
              type="submit"
              className="w-full rounded-md bg-black px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800"
            >
              Create Listing
            </button>
          </form>
        </div>
      </div>
    </main>
  );
}