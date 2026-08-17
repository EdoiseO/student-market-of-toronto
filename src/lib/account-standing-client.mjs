export const ACCOUNT_STANDING_ACTIONS = Object.freeze({
  acknowledge: "acknowledge",
  requestReview: "request_review",
});

export async function performAccountStandingAction(supabase, action, sanctionId) {
  if (!supabase || typeof sanctionId !== "string" || !sanctionId.trim()) {
    return { error: new Error("account_standing_action_invalid") };
  }

  if (action === ACCOUNT_STANDING_ACTIONS.acknowledge) {
    return supabase.rpc("acknowledge_moderation_sanction", {
      p_sanction_id: sanctionId,
    });
  }

  if (action === ACCOUNT_STANDING_ACTIONS.requestReview) {
    return supabase.rpc("request_moderation_sanction_review", {
      p_sanction_id: sanctionId,
    });
  }

  return { error: new Error("account_standing_action_unsupported") };
}
