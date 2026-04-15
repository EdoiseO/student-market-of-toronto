import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";

import { EditListingForm } from "@/components/edit-listing-form";
import { isListingApprovalSetupMissing } from "@/lib/listing-approval";
import { createClient } from "@/utils/supabase/server";

const EDIT_LISTING_SELECT = `
  id,
  slug,
  seller_id,
  title,
  description,
  price,
  previous_price,
  status,
  submitted_for_review_at,
  moderation_feedback,
  moderation_reviewed_at,
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
`;

const EDIT_LISTING_FALLBACK_SELECT = `
  id,
  slug,
  seller_id,
  title,
  description,
  price,
  previous_price,
  status,
  submitted_for_review_at,
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
`;

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

  let { data: listing, error } = await supabase
    .from("listings")
    .select(EDIT_LISTING_SELECT)
    .eq("slug", resolvedParams.slug)
    .eq("seller_id", user.id)
    .single();

  if (error && isListingApprovalSetupMissing(error)) {
    const fallbackResult = await supabase
      .from("listings")
      .select(EDIT_LISTING_FALLBACK_SELECT)
      .eq("slug", resolvedParams.slug)
      .eq("seller_id", user.id)
      .single();

    listing = fallbackResult.data;
    error = fallbackResult.error;
  }

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
