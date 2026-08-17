import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { getProfileNameFingerprint } from "@/lib/name-sanction.mjs";
import { createAdminClient } from "@/lib/supabase-admin";
import { getUserStatusRow, isUserBanned } from "@/lib/user-status";
import { validateProfileIdentity } from "@/lib/write-field-contracts.mjs";
import { createClient } from "@/utils/supabase/server";

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

  const userStatusResult = await getUserStatusRow(supabase, user.id);

  if (userStatusResult.available !== true || userStatusResult.error) {
    return NextResponse.json(
      { error: "Could not verify your account standing." },
      { status: 503 },
    );
  }

  if (isUserBanned(userStatusResult.data)) {
    return NextResponse.json(
      { error: "Account changes are unavailable while this account is restricted." },
      { status: 403 },
    );
  }

  try {
    const payload = await request.json().catch(() => null);
    const identity = validateProfileIdentity(payload);

    if (!identity.ok) {
      return NextResponse.json(
        {
          error: "Enter a first and last name between 1 and 100 characters.",
          fieldErrors: identity.errors,
        },
        { status: 400 },
      );
    }

    const { firstName, lastName } = identity.values;

    const nameFingerprint = getProfileNameFingerprint(firstName, lastName);
    const { data: clearedRequiredNameChange, error: profileError } = await admin.rpc(
      "save_profile_identity_from_server",
      {
        p_subject_user_id: user.id,
        p_first_name: firstName,
        p_last_name: lastName,
        p_name_fingerprint: nameFingerprint,
      },
    );

    if (profileError) {
      const profileErrorText = [profileError.message, profileError.details, profileError.hint]
        .filter(Boolean)
        .join(" ");

      if (profileErrorText.includes("profile_name_rejected")) {
        return NextResponse.json(
          { error: "Choose a different first or last name." },
          { status: 409 },
        );
      }
      if (profileErrorText.includes("force_name_change_operation_in_progress")) {
        return NextResponse.json(
          { error: "A moderator action is still being completed. Try again shortly." },
          { status: 409 },
        );
      }
      if (profileErrorText.includes("account_is_banned")) {
        return NextResponse.json(
          { error: "Account changes are unavailable while this account is restricted." },
          { status: 403 },
        );
      }
      throw profileError;
    }

    if (clearedRequiredNameChange === null) {
      return NextResponse.json(
        { error: "A moderator action is still being completed. Try again shortly." },
        { status: 409 },
      );
    }

    return NextResponse.json({
      success: true,
      requiresNameChange: false,
      clearedRequiredNameChange: clearedRequiredNameChange === true,
    });
  } catch (error) {
    console.error("Failed to update trusted profile name:", error?.message ?? error);
    return NextResponse.json(
      { error: "Could not update your profile name right now." },
      { status: 500 },
    );
  }
}
