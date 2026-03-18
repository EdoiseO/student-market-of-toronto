"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { createClient } from "@/utils/supabase/client";

export default function EditListingPage() {
  const { id } = useParams();
  const router = useRouter();
  const supabase = createClient();

  const [form, setForm] = useState({
    title: "",
    price: "",
    category: "",
    condition: "",
    location: "",
    status: "Available",
  });

  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchListing() {
      const { data, error } = await supabase
        .from("listings")
        .select("*")
        .eq("id", id)
        .single();

      if (error) {
        console.error(error);
      } else {
        setForm(data);
      }

      setLoading(false);
    }
    if (!id) return;
    fetchListing();
  }, [id, supabase]);

  async function handleUpdate(e) {
    e.preventDefault();

    const { error } = await supabase.from("listings").update(form).eq("id", id);

    if (error) {
      alert(error.message);
    } else {
      alert("Updated successfully ✅");
      router.push("/my-listings");
    }
  }

  if (loading) return <p>Loading...</p>;

  return (
    <main className="p-6 max-w-xl mx-auto">
      <h1 className="text-2xl font-bold mb-4">Edit Listing</h1>

      <form onSubmit={handleUpdate} className="space-y-4">
        <input
          placeholder="Title"
          value={form.title}
          onChange={(e) => setForm({ ...form, title: e.target.value })}
          className="w-full border p-2"
        />

        <input
          placeholder="Price"
          value={form.price}
          onChange={(e) => setForm({ ...form, price: e.target.value })}
          className="w-full border p-2"
        />

        <input
          placeholder="Category"
          value={form.category}
          onChange={(e) => setForm({ ...form, category: e.target.value })}
          className="w-full border p-2"
        />

        <input
          placeholder="Condition"
          value={form.condition}
          onChange={(e) => setForm({ ...form, condition: e.target.value })}
          className="w-full border p-2"
        />

        <input
          placeholder="Location"
          value={form.location}
          onChange={(e) => setForm({ ...form, location: e.target.value })}
          className="w-full border p-2"
        />

        <button className="bg-black text-white px-4 py-2">Save Changes</button>
      </form>
    </main>
  );
}
