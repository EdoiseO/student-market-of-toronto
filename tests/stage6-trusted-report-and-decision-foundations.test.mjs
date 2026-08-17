import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  countUnicodeCodePoints,
  normalizeWriteText,
  validateMessageBody,
  validateForceNameDecision,
  validateReportDecisionSummary,
  validateReportDetails,
  validateReportedListingDecision,
} from "../src/lib/write-field-contracts.mjs";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("Stage 6 report submission derives bindings and keeps the legacy grant until cutover", async () => {
  const [sql, sheet, translations] = await Promise.all([
    read("../supabase/migrations/20260816193136_trusted_marketplace_report_submission.sql"),
    read("../src/components/report-sheet.jsx"),
    read("../src/lib/translations.js"),
  ]);

  assert.match(sql, /create schema if not exists report_submission_private/i);
  assert.match(sql, /security invoker[\s\S]*submit_marketplace_report_impl/i);
  assert.match(sql, /actor_id uuid := auth\.uid\(\)/i);
  assert.match(sql, /listing\.status = 'active'/i);
  assert.doesNotMatch(sql, /profile\.is_public/i);
  assert.match(
    sql,
    /actor_id is distinct from conversation_row\.buyer_id[\s\S]*actor_id is distinct from conversation_row\.seller_id/i,
  );
  assert.match(sql, /message_row\.sender_id/i);
  assert.match(sql, /report_self_submission_not_allowed/i);
  assert.match(sql, /normalized_reason = 'other'[\s\S]*between 10 and 600/i);
  assert.match(sql, /unique \(actor_user_id_snapshot, operation_id\)/i);
  assert.match(sql, /report_operation_payload_conflict/i);
  assert.match(sql, /result - array\['id', 'status'\] = '\{\}'::jsonb/i);
  assert.match(sql, /return existing_command\.result/i);
  assert.ok(
    sql.indexOf("return existing_command.result") < sql.indexOf("message = 'account_banned'"),
    "exact command replay must precede mutable ban checks",
  );
  assert.doesNotMatch(sql, /returns public\.reports/i);
  assert.doesNotMatch(sql, /revoke insert on table public\.reports/i);
  assert.doesNotMatch(sheet, /\.from\("reports"\)\.insert/);
  assert.match(sheet, /rpc\("submit_marketplace_report"/);
  assert.match(sheet, /operationId: crypto\.randomUUID\(\)/);
  assert.doesNotMatch(sheet, /maxLength=/);
  assert.match(sheet, /Array\.from\(details\)\.length/);
  assert.match(sheet, /reportOtherDetailsDescription/);
  assert.match(sheet, /aria-required=\{isOtherReason\}/);
  assert.match(sheet, /aria-invalid=\{Boolean\(detailsError\)\}/);
  assert.match(sheet, /report-details-description[\s\S]*report-details-error/);
  assert.equal((translations.match(/reportOtherDetailsDescription:/g) ?? []).length, 2);
});

test("Unicode code-point boundaries match report and action-specific decision contracts", () => {
  const normalizedListingFeedbackBoundary = normalizeWriteText(
    `${"a".repeat(2998)}\r\nb`,
  );
  assert.equal(countUnicodeCodePoints(normalizedListingFeedbackBoundary), 3000);
  assert.equal(validateReportDetails("😀".repeat(600), { isOther: false }).ok, true);
  assert.equal(validateReportDetails("😀".repeat(601), { isOther: false }).ok, false);
  assert.equal(validateReportDetails("😀".repeat(9), { isOther: true }).ok, false);
  assert.equal(validateReportDetails("😀".repeat(10), { isOther: true }).ok, true);
  assert.equal(validateReportDecisionSummary("😀".repeat(10)).ok, true);
  assert.equal(validateReportDecisionSummary("😀".repeat(1001)).ok, false);
  assert.equal(validateMessageBody("😀".repeat(2000)).ok, true);
  assert.equal(validateMessageBody("😀".repeat(2001)).ok, false);
  assert.equal(validateMessageBody("\u00A0\u2003\uFEFF").error, "required");
  assert.equal(validateMessageBody("\r\n\t", { allowEmpty: true }).value, null);
  assert.equal(
    validateReportedListingDecision({
      sellerFeedback: "😀".repeat(10),
      privateSummary: "😀".repeat(1000),
    }).ok,
    true,
  );
  assert.equal(
    validateForceNameDecision({
      policyReason: "😀".repeat(10),
      userMessage: "😀".repeat(10),
      privateNote: "😀".repeat(4000),
    }).ok,
    true,
  );
});

test("Stage 6 moderation rationale foundation is append-only, bounded, private, and reviewable", async () => {
  const [sql, route, listingRoute, reportUi, listingUi, notifications, auditPage, reportPage, translations] = await Promise.all([
    read("../supabase/migrations/20260816193317_moderation_decision_requirements_foundation.sql"),
    read("../src/app/api/admin/reports/actions/route.js"),
    read("../src/app/api/admin/listings/[listingId]/decision/route.js"),
    read("../src/components/admin-report-review-content.jsx"),
    read("../src/components/admin-listing-approval-review-content.jsx"),
    read("../src/lib/notifications.js"),
    read("../src/app/admin/audit/page.jsx"),
    read("../src/app/admin/reports/[reportId]/page.jsx"),
    read("../src/lib/translations.js"),
  ]);

  assert.match(sql, /create schema if not exists moderation_decision_private/i);
  assert.match(sql, /actor_auth_banned_until[\s\S]*moderation_actor_is_banned/i);
  assert.match(sql, /moderation_decision_record_is_immutable[\s\S]*before update or delete/i);
  assert.match(sql, /unique \(actor_user_id_snapshot, request_id\)/i);
  assert.match(sql, /report_resolved'[\s\S]*between 10 and 1000/i);
  assert.match(sql, /reported_listing_removed'[\s\S]*between 10 and 3000/i);
  assert.match(sql, /profile_name_change_required'[\s\S]*policy_reason[\s\S]*between 10 and 1000/i);
  assert.match(sql, /private_note is null or char_length\(private\.normalize_user_prose\(private_note\)\) between 1 and 4000/i);
  assert.match(sql, /create table moderation_decision_private\.report_notes/i);
  assert.doesNotMatch(sql, /update public\.reports\s+set moderator_notes/i);
  assert.match(sql, /get_report_notes_impl[\s\S]*cardinality\(p_report_ids\) not between 1 and 100/i);
  assert.match(sql, /get_records_by_audit_ids_impl[\s\S]*actor_role <> 'admin'/i);
  assert.match(sql, /cardinality\(p_audit_event_ids\) not between 1 and 100/i);
  assert.match(sql, /security invoker[\s\S]*get_records_by_audit_ids_impl\(p_audit_event_ids\)/i);
  assert.match(sql, /private_summary[\s\S]*moderation_request_id_payload_conflict/i);
  assert.match(sql, /jsonb_build_object\('has_note', normalized_note is not null\)/i);
  assert.match(
    sql,
    /notification_metadata := jsonb_build_object\(\s*'listing_title',[\s\S]*?'feedback', normalized_feedback\s*\)/i,
  );
  assert.match(
    sql,
    /notification_metadata := jsonb_build_object\(\s*'href', '\/dashboard\/settings',\s*'user_message', operation\.user_message\s*\)/i,
  );
  assert.match(route, /validateReportDecisionSummary/);
  assert.match(route, /validateReportedListingDecision/);
  assert.match(route, /validateForceNameDecision/);
  assert.match(route, /validateModeratorNote/);
  assert.match(route, /decide_report_set_with_summary/);
  assert.match(route, /remove_reported_listing_with_rationale/);
  assert.match(route, /begin_force_name_operation_with_rationale/);
  assert.match(route, /complete_force_name_operation_with_rationale/);
  assert.doesNotMatch(
    route,
    /operation\.operation_status === "completed"\)[\s\S]{0,180}operation\.result_updated_count/,
  );
  assert.match(route, /save_report_moderator_note/);
  assert.doesNotMatch(route, /\.from\("reports"\)\s*\.update/);
  assert.doesNotMatch(reportUi, /maxLength=/);
  const reportGridIndex = reportUi.indexOf("grid items-start gap-4");
  const reportEvidenceColumnIndex = reportUi.indexOf("min-w-0 space-y-5 xl:space-y-6", reportGridIndex);
  const reportEvidenceIndex = reportUi.indexOf("{isMessageReport ? (", reportEvidenceColumnIndex);
  const moderatorNotesIndex = reportUi.indexOf("<ModeratorNotesCard", reportEvidenceIndex);
  const reportContextColumnIndex = reportUi.indexOf(
    '<div className="space-y-5 xl:space-y-6">',
    moderatorNotesIndex,
  );
  const relatedReportsIndex = reportUi.indexOf("adminRelatedReportsTitle", reportContextColumnIndex);
  const decisionDetailsIndex = reportUi.indexOf("adminReportDecisionDetailsTitle", relatedReportsIndex);
  assert.ok(
    reportGridIndex >= 0
      && reportGridIndex < reportEvidenceColumnIndex
      && reportEvidenceColumnIndex < reportEvidenceIndex
      && reportGridIndex < reportEvidenceIndex
      && reportEvidenceIndex < moderatorNotesIndex
      && moderatorNotesIndex < reportContextColumnIndex
      && reportContextColumnIndex < relatedReportsIndex
      && moderatorNotesIndex < relatedReportsIndex
      && relatedReportsIndex < decisionDetailsIndex,
    "evidence and moderator notes must stay in the left column before the right-rail context and full-width decision details",
  );
  assert.equal(
    (reportUi.match(/<ModeratorNotesCard/g) ?? []).length,
    1,
    "all report types must render the same moderator-notes card below their evidence",
  );
  assert.match(
    reportUi,
    /REPORT_EVIDENCE_PANEL_CLASS[\s\S]*xl:h-\[clamp\(28rem,60vh,34rem\)\]/,
  );
  assert.equal(
    (reportUi.match(/<section className=\{REPORT_EVIDENCE_PANEL_CLASS\}>/g) ?? []).length,
    3,
    "message, profile, and listing evidence must share one desktop viewport size",
  );
  assert.match(reportUi, /min-h-0 flex-1 space-y-5 overflow-y-auto/);
  assert.doesNotMatch(reportUi, /max-h-\[60vh\]/);
  assert.doesNotMatch(reportUi, /\bcompact\b/);
  assert.ok(
    reportUi.indexOf("adminConversationContextLabel")
      < reportUi.indexOf("adminReportDecisionDetailsTitle"),
    "report and conversation context should appear before decision controls",
  );
  assert.match(reportUi, /lg:min-h-\[4\.75rem\]/);
  assert.match(reportUi, /canRemoveListing \|\| canForceNameChange \? "lg:grid-cols-2" : "lg:grid-cols-1"/);
  assert.match(reportUi, /min-h-32 resize-y rounded-xl/);
  assert.match(reportUi, /space-y-5 xl:space-y-6/);
  assert.match(reportUi, /flex min-h-44 flex-col justify-center gap-4 px-7 py-6/);
  assert.match(reportUi, /flex min-h-44 items-center px-7 py-6/);
  assert.match(reportUi, /flex min-h-52 flex-col justify-center gap-0 px-7 py-6/);
  assert.match(reportUi, /flex min-h-20 items-center gap-3 rounded-xl/);
  assert.match(reportUi, /<CardFooter[\s\S]*?<ReportDecisionActions/);
  assert.equal(
    (reportUi.match(/router\.push\("\/admin\/reports"\)/g) ?? []).length,
    3,
    "all successful report actions must return to the reports registry",
  );
  assert.doesNotMatch(reportUi, /router\.push\("\/admin"\)/);
  assert.match(reportPage, /<Link href="\/admin\/reports">/);
  assert.doesNotMatch(reportPage, /<Link href="\/admin">/);
  assert.equal((translations.match(/adminReportDecisionDetailsTitle:/g) ?? []).length, 2);
  assert.equal((translations.match(/adminDecisionActionSaveHint:/g) ?? []).length, 2);

  assert.doesNotMatch(listingUi, /maxLength=/);
  assert.match(listingRoute, /normalizeWriteText\(feedback\)/);
  assert.match(listingRoute, /countUnicodeCodePoints\(sellerFeedback\)/);
  assert.match(listingUi, /adminListingFeedbackRequiredMarker/);
  assert.match(listingUi, /aria-required=\{isPendingReview \? "true" : "false"\}/);
  assert.match(listingUi, /aria-invalid=\{Boolean\(feedbackError\)\}/);
  assert.match(listingUi, /listing-moderation-feedback-error/);
  assert.equal((translations.match(/adminListingFeedbackRequiredMarker:/g) ?? []).length, 2);
  assert.equal((translations.match(/adminListingFeedbackTooLong:/g) ?? []).length, 2);
  assert.match(auditPage, /rpc\("get_moderation_decision_records"/);
  assert.match(auditPage, /decision\?\.private_note/);
  assert.match(reportPage, /rpc\(\s*"get_report_moderator_notes"/);
  assert.doesNotMatch(reportPage, /MODERATION_REPORT_NOTES_SELECT/);
  assert.match(notifications, /LISTING_REMOVED_NOTIFICATION_TYPE/);
  assert.match(notifications, /PROFILE_NAME_CHANGE_REQUIRED_NOTIFICATION_TYPE/);
  assert.match(notifications, /Array\.from\(feedback\.trim\(\)\)\.slice\(0, 3000\)/);
});

test("all application message sends use one stable idempotent operation and Unicode-safe fields", async () => {
  const [thread, starter] = await Promise.all([
    read("../src/components/messages-thread.jsx"),
    read("../src/components/start-conversation-button.jsx"),
  ]);

  assert.doesNotMatch(thread, /rpc\("send_conversation_message_with_attachments"/);
  assert.doesNotMatch(starter, /rpc\("send_conversation_message_with_attachments"/);
  assert.match(thread, /send_conversation_message_idempotent/);
  assert.match(thread, /reserveMessageMediaUploadsIdempotent/);
  assert.match(thread, /p_operation_id: intent\.operationId/);
  assert.match(thread, /callMessageMutationWithReplay/);
  assert.match(thread, /abort_message_send_operation/);
  assert.match(thread, /setUnresolvedSendIntent\(intent\)/);
  assert.match(thread, /validateMessageBody/);
  assert.match(thread, /countUnicodeCodePoints/);
  assert.doesNotMatch(thread, /maxLength=\{2000\}/);
  assert.match(starter, /send_conversation_message_idempotent/);
  assert.match(starter, /p_operation_id: intent\.operationId/);
  assert.match(starter, /abort_message_send_operation/);
  assert.match(starter, /unresolvedFirstMessageIntent/);
  assert.match(starter, /p_attachments: \[\]/);
  assert.doesNotMatch(starter, /maxLength=\{2000\}/);
});
