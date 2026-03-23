import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";

import { EditListingForm } from "@/components/edit-listing-form";
import { createClient } from "@/utils/supabase/server";

export default async function EditListingPage({ params }) {
  const resolvedParams = await params;
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: listing, error } = await supabase
    .from("listings")
    .select(
      `
        id,
        slug,
        seller_id,
        title,
        description,
        price,
        previous_price,
        category,
        condition,
        location,
        is_negotiable,
        listing_images (
          id,
          image_url,
          storage_path,
          position
        )
      `,
    )
    .eq("slug", resolvedParams.slug)
    .eq("seller_id", user.id)
    .single();

  if (error || !listing) {
    notFound();
  }

  return (
    <EditListingForm
      listing={{
        ...listing,
        listing_images: (listing.listing_images ?? []).sort(
          (left, right) => left.position - right.position,
        ),
      }}
    />
  );
}
