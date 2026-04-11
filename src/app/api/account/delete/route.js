import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient as createSupabaseAdminClient } from "@supabase/supabase-js";

import { extractProfileImageStoragePath } from "@/lib/profile-avatar";
import { createClient } from "@/utils/supabase/server";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

function createAdminClient() {
  if (!supabaseUrl || !supabaseServiceRoleKey) {
    return null;
  }

  return createSupabaseAdminClient(supabaseUrl, supabaseServiceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

function isSkippableCleanupError(error) {
  return (
    error?.code === "42P01" ||
    error?.code === "PGRST205" ||
    error?.code === "42703" ||
    error?.code === "PGRST204"
  );
}

async function deleteWhereEquals(admin, table, column, value) {
  const { error } = await admin.from(table).delete().eq(column, value);

  if (error && !isSkippableCleanupError(error)) {
    throw error;
  }
}

async function deleteProfileSubjectReports(admin, userId) {
  const { error } = await admin
    .from("reports")
    .delete()
    .eq("subject_type", "profile")
    .eq("subject_id", userId);

  if (error && !isSkippableCleanupError(error)) {
    throw error;
  }
}

async function deleteWhereIn(admin, table, column, values) {
  if (!values.length) {
    return;
  }

  const { error } = await admin.from(table).delete().in(column, values);

  if (error && !isSkippableCleanupError(error)) {
    throw error;
  }
}

async function scrubProfile(admin, userId) {
  const { error } = await admin
    .from("profiles")
    .update({
      first_name: "Deleted",
      last_name: "Account",
      school: null,
      avatar_preset_id: null,
      avatar_url: null,
      bio: null,
      is_public: false,
      updated_at: new Date().toISOString(),
    })
    .eq("id", userId);

  if (error && !isSkippableCleanupError(error)) {
    throw error;
  }
}

async function removeStorageObjects(admin, bucket, paths) {
  if (!paths.length) {
    return;
  }

  const { error } = await admin.storage.from(bucket).remove(paths);

  if (error) {
    console.error(`Failed to remove storage objects from ${bucket}:`, error.message);
  }
}

export async function POST() {
  const admin = createAdminClient();

  if (!admin) {
    return NextResponse.json(
      { error: "Account deletion is not configured in this environment." },
      { status: 503 },
    );
  }

  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: "You must be signed in." }, { status: 401 });
  }

  try {
    const [{ data: profileRow, error: profileError }, { data: ownedListings, error: listingsError }] =
      await Promise.all([
        admin.from("profiles").select("avatar_url").eq("id", user.id).maybeSingle(),
        admin.from("listings").select("id").eq("seller_id", user.id),
      ]);

    if (profileError && !isSkippableCleanupError(profileError)) {
      throw profileError;
    }

    if (listingsError && !isSkippableCleanupError(listingsError)) {
      throw listingsError;
    }

    const listingIds = (ownedListings ?? []).map((listing) => listing.id);
    const [listingImagesResult, conversationsResult] = await Promise.all([
      listingIds.length > 0
        ? admin.from("listing_images").select("storage_path").in("listing_id", listingIds)
        : Promise.resolve({ data: [], error: null }),
      admin
        .from("conversations")
        .select("id")
        .or(`buyer_id.eq.${user.id},seller_id.eq.${user.id}`),
    ]);

    if (listingImagesResult.error && !isSkippableCleanupError(listingImagesResult.error)) {
      throw listingImagesResult.error;
    }

    if (conversationsResult.error && !isSkippableCleanupError(conversationsResult.error)) {
      throw conversationsResult.error;
    }

    const conversationIds = (conversationsResult.data ?? []).map((conversation) => conversation.id);
    const messagesResult = conversationIds.length
      ? await admin.from("messages").select("id").in("conversation_id", conversationIds)
      : { data: [], error: null };

    if (messagesResult.error && !isSkippableCleanupError(messagesResult.error)) {
      throw messagesResult.error;
    }

    const messageIds = (messagesResult.data ?? []).map((message) => message.id);
    const listingImagePaths = (listingImagesResult.data ?? [])
      .map((image) => image.storage_path)
      .filter(Boolean);
    const profileImagePath = extractProfileImageStoragePath(profileRow?.avatar_url ?? null);

    await deleteWhereEquals(admin, "notification_preferences", "user_id", user.id);
    await deleteWhereEquals(admin, "notifications", "user_id", user.id);
    await deleteWhereEquals(admin, "listing_favourites", "user_id", user.id);
    await deleteWhereEquals(admin, "conversation_user_state", "user_id", user.id);
    await deleteWhereEquals(admin, "reports", "reporter_user_id", user.id);
    await deleteWhereEquals(admin, "reports", "reported_user_id", user.id);
    await deleteWhereEquals(admin, "reports", "reviewed_by", user.id);
    await deleteWhereEquals(admin, "reports", "moderator_notes_updated_by", user.id);
    await deleteProfileSubjectReports(admin, user.id);
    await deleteWhereEquals(admin, "listing_moderation_history", "decided_by", user.id);

    if (listingIds.length > 0) {
      await deleteWhereIn(admin, "listing_favourites", "listing_id", listingIds);
      await deleteWhereIn(admin, "notifications", "listing_id", listingIds);
      await deleteWhereIn(admin, "reports", "listing_id", listingIds);
      await deleteWhereIn(admin, "listing_moderation_history", "listing_id", listingIds);
    }

    if (listingIds.length > 0) {
      await deleteWhereIn(admin, "listing_images", "listing_id", listingIds);
      await deleteWhereIn(admin, "listings", "id", listingIds);
    }

    await scrubProfile(admin, user.id);

    await removeStorageObjects(admin, "listing-images", listingImagePaths);
    await removeStorageObjects(admin, "profile-images", profileImagePath ? [profileImagePath] : []);

    const { error: deleteUserError } = await admin.auth.admin.deleteUser(user.id, true);

    if (deleteUserError) {
      throw deleteUserError;
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Failed to delete account:", error);
    return NextResponse.json(
      { error: "We could not delete your account right now." },
      { status: 500 },
    );
  }
}
