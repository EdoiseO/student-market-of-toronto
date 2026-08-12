import { NextResponse } from "next/server";
import { cookies } from "next/headers";

import {
  isOwnedMessageMediaStoragePath,
  MESSAGE_MEDIA_RESERVATION_BUCKET,
} from "@/lib/message-media-reservations.mjs";
import { extractOwnedProfileImageStoragePath } from "@/lib/profile-avatar";
import { isOwnedStoragePath } from "@/lib/storage-path-ownership.mjs";
import { createAdminClient } from "@/lib/supabase-admin";
import { createClient } from "@/utils/supabase/server";

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

async function deleteWhereIn(admin, table, column, values) {
  if (!values.length) {
    return;
  }

  const { error } = await admin.from(table).delete().in(column, values);

  if (error && !isSkippableCleanupError(error)) {
    throw error;
  }
}

async function anonymizeOwnedListings(admin, userId, listingIds) {
  if (!listingIds.length) {
    return;
  }

  const { error } = await admin
    .from("listings")
    .update({
      title: "Deleted listing",
      description: "",
      status: "inactive",
    })
    .eq("seller_id", userId)
    .in("id", listingIds);

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

async function removeStorageObjectsOrThrow(admin, bucket, paths) {
  if (!paths.length) {
    return;
  }

  const { error } = await admin.storage.from(bucket).remove(paths);

  if (error) {
    throw error;
  }
}

async function retireOutstandingMessageMediaReservations(admin, userId) {
  const { data, error } = await admin.rpc("prepare_message_media_account_cleanup", {
    p_user_id: userId,
  });

  if (error || !Array.isArray(data)) {
    throw error ?? new Error("Message media cleanup returned an invalid path set.");
  }

  const storagePaths = data.map((reservation) => reservation?.storage_path);
  const uniqueStoragePaths = [...new Set(storagePaths)];

  if (
    uniqueStoragePaths.length !== storagePaths.length ||
    uniqueStoragePaths.some(
      (storagePath) => !isOwnedMessageMediaStoragePath(storagePath, userId),
    )
  ) {
    throw new Error("Message media cleanup refused an unsafe reservation path.");
  }

  await removeStorageObjectsOrThrow(
    admin,
    MESSAGE_MEDIA_RESERVATION_BUCKET,
    uniqueStoragePaths,
  );

  const { data: retiredCount, error: retireError } = await admin.rpc(
    "retire_message_media_account_reservations",
    {
      p_user_id: userId,
      p_storage_paths: uniqueStoragePaths,
    },
  );

  if (retireError || retiredCount !== uniqueStoragePaths.length) {
    throw retireError ?? new Error("Message media reservations were not fully retired.");
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
    // Establish a durable database barrier before enumeration. New reservations
    // and Storage inserts remain blocked even between these service API calls.
    await retireOutstandingMessageMediaReservations(admin, user.id);

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
    const ownedListingIds = new Set(listingIds);
    const listingImagesResult = listingIds.length > 0
      ? await admin
          .from("listing_images")
          .select("listing_id, storage_path")
          .in("listing_id", listingIds)
      : { data: [], error: null };

    if (listingImagesResult.error && !isSkippableCleanupError(listingImagesResult.error)) {
      throw listingImagesResult.error;
    }

    const messageAttachmentsResult = await admin
      .from("message_attachments")
      .select("storage_path")
      .eq("uploader_id", user.id);

    if (
      messageAttachmentsResult.error &&
      !isSkippableCleanupError(messageAttachmentsResult.error)
    ) {
      throw messageAttachmentsResult.error;
    }

    const messageMediaPaths = (messageAttachmentsResult.data ?? [])
      .map((attachment) => attachment.storage_path)
      .filter((storagePath) => isOwnedMessageMediaStoragePath(storagePath, user.id));
    const listingImagePaths = (listingImagesResult.data ?? [])
      .filter(
        (image) =>
          ownedListingIds.has(image.listing_id) &&
          isOwnedStoragePath(image.storage_path, user.id, image.listing_id),
      )
      .map((image) => image.storage_path);
    const profileImagePath = extractOwnedProfileImageStoragePath(
      profileRow?.avatar_url ?? null,
      user.id,
    );

    await deleteWhereEquals(admin, "notification_preferences", "user_id", user.id);
    await deleteWhereEquals(admin, "notifications", "user_id", user.id);
    await deleteWhereEquals(admin, "listing_favourites", "user_id", user.id);
    await deleteWhereEquals(admin, "conversation_user_state", "user_id", user.id);

    if (listingIds.length > 0) {
      await deleteWhereIn(admin, "listing_favourites", "listing_id", listingIds);
      await deleteWhereIn(admin, "notifications", "listing_id", listingIds);
    }

    if (listingIds.length > 0) {
      await deleteWhereIn(admin, "listing_images", "listing_id", listingIds);
      await anonymizeOwnedListings(admin, user.id, listingIds);
    }

    await scrubProfile(admin, user.id);

    await removeStorageObjects(admin, "listing-images", listingImagePaths);
    await removeStorageObjects(admin, "profile-images", profileImagePath ? [profileImagePath] : []);
    await removeStorageObjects(admin, MESSAGE_MEDIA_RESERVATION_BUCKET, messageMediaPaths);

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
