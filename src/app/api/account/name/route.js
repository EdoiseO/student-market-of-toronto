import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { isNameChangeRequired } from "@/lib/moderation";
import {
  REJECTED_PROFILE_NAME_FINGERPRINT_KEY,
  matchesRejectedProfileName,
} from "@/lib/name-sanction.mjs";
import { createAdminClient } from "@/lib/supabase-admin";
import { createClient } from "@/utils/supabase/server";

const MAX_PROFILE_NAME_LENGTH = 100;

function normalizeName(value) {
  if (typeof value !== "string") {
    return null;
  }

  return value.trim() || null;
}

export async function POST(request) {
  const admin = createAdminClient();

  if (!admin) {
    return NextResponse.json(
      { error: "Profile updates are not configured in this environment." },
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
    const payload = await request.json();
    const firstName = normalizeName(payload?.firstName);
    const lastName = normalizeName(payload?.lastName);

    if (
      (firstName?.length ?? 0) > MAX_PROFILE_NAME_LENGTH ||
      (lastName?.length ?? 0) > MAX_PROFILE_NAME_LENGTH
    ) {
      return NextResponse.json({ error: "Profile names are too long." }, { status: 400 });
    }

    const {
      data: { user: latestUser },
      error: latestUserError,
    } = await admin.auth.admin.getUserById(user.id);

    if (latestUserError || !latestUser) {
      console.error(
        "Failed to verify profile name update user:",
        latestUserError?.message ?? "Missing Auth user",
      );
      return NextResponse.json({ error: "Could not verify your account." }, { status: 503 });
    }

    const requiresNameChange = isNameChangeRequired(latestUser);

    if (requiresNameChange && (!firstName || !lastName)) {
      return NextResponse.json(
        { error: "Both first and last name are required." },
        { status: 400 },
      );
    }

    const rejectedNameFingerprint =
      latestUser.app_metadata?.[REJECTED_PROFILE_NAME_FINGERPRINT_KEY];

    if (
      requiresNameChange &&
      matchesRejectedProfileName(firstName, lastName, rejectedNameFingerprint)
    ) {
      return NextResponse.json(
        { error: "Choose a different first or last name." },
        { status: 409 },
      );
    }

    const nextAppMetadata = { ...(latestUser.app_metadata ?? {}) };

    if (requiresNameChange) {
      delete nextAppMetadata.force_name_change;
      delete nextAppMetadata[REJECTED_PROFILE_NAME_FINGERPRINT_KEY];
    }

    const nextUserMetadata = {
      ...(latestUser.user_metadata ?? {}),
      first_name: firstName,
      last_name: lastName,
    };
    delete nextUserMetadata.force_name_change;

    const { error: profileError } = await admin.from("profiles").upsert(
      {
        id: user.id,
        first_name: firstName,
        last_name: lastName,
      },
      { onConflict: "id" },
    );

    if (profileError) {
      throw profileError;
    }

    const { error: authUpdateError } = await admin.auth.admin.updateUserById(user.id, {
      user_metadata: nextUserMetadata,
      app_metadata: nextAppMetadata,
    });

    if (authUpdateError) {
      throw authUpdateError;
    }

    return NextResponse.json({ success: true, requiresNameChange: false });
  } catch (error) {
    console.error("Failed to update trusted profile name:", error?.message ?? error);
    return NextResponse.json(
      { error: "Could not update your profile name right now." },
      { status: 500 },
    );
  }
}
