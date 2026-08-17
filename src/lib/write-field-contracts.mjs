export const PROFILE_NAME_MIN_LENGTH = 1;
export const PROFILE_NAME_MAX_LENGTH = 100;
export const PROFILE_BIO_MAX_LENGTH = 1000;
export const REPORT_DETAILS_MAX_LENGTH = 600;
export const REPORT_OTHER_DETAILS_MIN_LENGTH = 10;
export const REPORT_DECISION_SUMMARY_MIN_LENGTH = 10;
export const REPORT_DECISION_SUMMARY_MAX_LENGTH = 1000;
export const REPORTED_LISTING_FEEDBACK_MIN_LENGTH = 10;
export const REPORTED_LISTING_FEEDBACK_MAX_LENGTH = 3000;
export const REPORTED_LISTING_PRIVATE_SUMMARY_MAX_LENGTH = 1000;
export const FORCE_NAME_POLICY_REASON_MIN_LENGTH = 10;
export const FORCE_NAME_POLICY_REASON_MAX_LENGTH = 1000;
export const FORCE_NAME_USER_MESSAGE_MIN_LENGTH = 10;
export const FORCE_NAME_USER_MESSAGE_MAX_LENGTH = 1000;
export const MODERATOR_NOTE_MAX_LENGTH = 4000;
export const MESSAGE_BODY_MAX_LENGTH = 2000;
export const LISTING_TITLE_MAX_LENGTH = 120;
export const LISTING_CATEGORY_MAX_LENGTH = 80;
export const LISTING_PRICE_MAX_CAD = 1_000_000;
export const LISTING_DESCRIPTION_MAX_LENGTH = 5000;
export const LISTING_CONDITION_MAX_LENGTH = 80;
export const LISTING_CAMPUS_MAX_LENGTH = 200;
export const LISTING_PHOTO_MIN_COUNT = 1;
export const LISTING_PHOTO_MAX_COUNT = 10;

export const WRITE_FIELD_ERROR_CODES = Object.freeze({
  required: "required",
  tooShort: "too_short",
  tooLong: "too_long",
  invalid: "invalid",
  outOfRange: "out_of_range",
});

export function countUnicodeCodePoints(value) {
  return Array.from(typeof value === "string" ? value : "").length;
}

export function normalizeWriteText(value, { emptyToNull = false } = {}) {
  const normalizedValue = typeof value === "string"
    ? value
        .replace(/\r\n?/g, "\n")
        .replace(
          /^[\u0009-\u000D\u0020\u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000\uFEFF]+|[\u0009-\u000D\u0020\u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000\uFEFF]+$/g,
          "",
        )
    : "";

  return emptyToNull && normalizedValue.length === 0 ? null : normalizedValue;
}

export function validateRequiredText(
  value,
  { minLength = 1, maxLength = Number.POSITIVE_INFINITY } = {},
) {
  const normalizedValue = normalizeWriteText(value);
  const length = countUnicodeCodePoints(normalizedValue);

  if (length < 1) {
    return {
      ok: false,
      value: normalizedValue,
      length,
      error: WRITE_FIELD_ERROR_CODES.required,
    };
  }

  if (length < minLength) {
    return {
      ok: false,
      value: normalizedValue,
      length,
      error: WRITE_FIELD_ERROR_CODES.tooShort,
    };
  }

  if (length > maxLength) {
    return {
      ok: false,
      value: normalizedValue,
      length,
      error: WRITE_FIELD_ERROR_CODES.tooLong,
    };
  }

  return { ok: true, value: normalizedValue, length, error: null };
}

export function validateOptionalText(
  value,
  { maxLength = Number.POSITIVE_INFINITY } = {},
) {
  const normalizedValue = normalizeWriteText(value, { emptyToNull: true });
  const length = countUnicodeCodePoints(normalizedValue ?? "");

  if (length > maxLength) {
    return {
      ok: false,
      value: normalizedValue,
      length,
      error: WRITE_FIELD_ERROR_CODES.tooLong,
    };
  }

  return { ok: true, value: normalizedValue, length, error: null };
}

export function validateProfileIdentity(input) {
  const { firstName, lastName } = input && typeof input === "object" ? input : {};
  const firstNameResult = validateRequiredText(firstName, {
    maxLength: PROFILE_NAME_MAX_LENGTH,
  });
  const lastNameResult = validateRequiredText(lastName, {
    maxLength: PROFILE_NAME_MAX_LENGTH,
  });
  const errors = {};

  if (!firstNameResult.ok) {
    errors.firstName = firstNameResult.error;
  }

  if (!lastNameResult.ok) {
    errors.lastName = lastNameResult.error;
  }

  return {
    ok: Object.keys(errors).length === 0,
    values: {
      firstName: firstNameResult.value,
      lastName: lastNameResult.value,
    },
    errors,
  };
}

export function validateProfileBio(value) {
  return validateOptionalText(value, { maxLength: PROFILE_BIO_MAX_LENGTH });
}

export function validateMessageBody(value, { allowEmpty = false } = {}) {
  return allowEmpty
    ? validateOptionalText(value, { maxLength: MESSAGE_BODY_MAX_LENGTH })
    : validateRequiredText(value, { maxLength: MESSAGE_BODY_MAX_LENGTH });
}

export function normalizeListingPrice(value) {
  if (value === null || value === undefined || (typeof value === "string" && value.trim() === "")) {
    return { ok: true, value: null, error: null };
  }

  if (typeof value !== "number" && typeof value !== "string") {
    return { ok: false, value: null, error: "price" };
  }

  const normalizedValue = Number(value);

  if (!Number.isFinite(normalizedValue)) {
    return { ok: false, value: null, error: "price" };
  }

  if (normalizedValue < 0 || normalizedValue > LISTING_PRICE_MAX_CAD) {
    return { ok: false, value: normalizedValue, error: "price" };
  }

  return { ok: true, value: normalizedValue, error: null };
}

export function validateListingDraftFields(input) {
  const { title } = input && typeof input === "object" ? input : {};
  const titleResult = validateRequiredText(title, {
    maxLength: LISTING_TITLE_MAX_LENGTH,
  });

  return {
    ok: titleResult.ok,
    values: { title: titleResult.value },
    errors: titleResult.ok ? {} : { title: titleResult.error },
  };
}

export function validateListingPublishFields(input) {
  const { title, category, price, description, condition, campus, photoCount } =
    input && typeof input === "object" ? input : {};
  const results = {
    title: validateRequiredText(title, { maxLength: LISTING_TITLE_MAX_LENGTH }),
    category: validateRequiredText(category, { maxLength: LISTING_CATEGORY_MAX_LENGTH }),
    price: normalizeListingPrice(price),
    description: validateRequiredText(description, {
      maxLength: LISTING_DESCRIPTION_MAX_LENGTH,
    }),
    condition: validateRequiredText(condition, { maxLength: LISTING_CONDITION_MAX_LENGTH }),
    campus: validateRequiredText(campus, { maxLength: LISTING_CAMPUS_MAX_LENGTH }),
  };
  const normalizedPhotoCount = typeof photoCount === "number" ? photoCount : Number.NaN;
  const photoCountIsValid = Number.isInteger(normalizedPhotoCount)
    && normalizedPhotoCount >= LISTING_PHOTO_MIN_COUNT
    && normalizedPhotoCount <= LISTING_PHOTO_MAX_COUNT;
  const errors = {};

  for (const [field, result] of Object.entries(results)) {
    if (!result.ok || (field === "price" && result.value === null)) {
      errors[field] = field === "price" && result.value === null
        ? WRITE_FIELD_ERROR_CODES.required
        : result.error;
    }
  }

  if (!photoCountIsValid) {
    errors.photos = Number.isInteger(normalizedPhotoCount)
      ? WRITE_FIELD_ERROR_CODES.outOfRange
      : WRITE_FIELD_ERROR_CODES.invalid;
  }

  return {
    ok: Object.keys(errors).length === 0,
    values: {
      title: results.title.value,
      category: results.category.value,
      price: results.price.value,
      description: results.description.value,
      condition: results.condition.value,
      campus: results.campus.value,
      photoCount: normalizedPhotoCount,
    },
    errors,
  };
}

function withContractError(result, error) {
  return result.ok
    ? { ok: true, value: result.value, error: null }
    : { ok: false, value: result.value, error };
}

export function validateReportDetails(value, { isOther = false } = {}) {
  const result = isOther
    ? validateRequiredText(value, {
        minLength: REPORT_OTHER_DETAILS_MIN_LENGTH,
        maxLength: REPORT_DETAILS_MAX_LENGTH,
      })
    : validateOptionalText(value, { maxLength: REPORT_DETAILS_MAX_LENGTH });

  return withContractError(
    result,
    isOther ? "report_other_details" : "report_details",
  );
}

export function validateReportDecisionSummary(value) {
  return withContractError(
    validateRequiredText(value, {
      minLength: REPORT_DECISION_SUMMARY_MIN_LENGTH,
      maxLength: REPORT_DECISION_SUMMARY_MAX_LENGTH,
    }),
    "report_decision_summary",
  );
}

export function validateReportedListingDecision(input) {
  const { sellerFeedback, privateSummary } =
    input && typeof input === "object" ? input : {};
  const feedbackResult = validateRequiredText(sellerFeedback, {
    minLength: REPORTED_LISTING_FEEDBACK_MIN_LENGTH,
    maxLength: REPORTED_LISTING_FEEDBACK_MAX_LENGTH,
  });
  const privateSummaryResult = validateOptionalText(privateSummary, {
    maxLength: REPORTED_LISTING_PRIVATE_SUMMARY_MAX_LENGTH,
  });

  return {
    ok: feedbackResult.ok && privateSummaryResult.ok,
    value: {
      sellerFeedback: feedbackResult.value,
      privateSummary: privateSummaryResult.value,
    },
    error: !feedbackResult.ok
      ? "seller_feedback"
      : !privateSummaryResult.ok
        ? "private_summary"
        : null,
  };
}

export function validateForceNameDecision(input) {
  const { policyReason, userMessage, privateNote } =
    input && typeof input === "object" ? input : {};
  const policyReasonResult = validateRequiredText(policyReason, {
    minLength: FORCE_NAME_POLICY_REASON_MIN_LENGTH,
    maxLength: FORCE_NAME_POLICY_REASON_MAX_LENGTH,
  });
  const userMessageResult = validateRequiredText(userMessage, {
    minLength: FORCE_NAME_USER_MESSAGE_MIN_LENGTH,
    maxLength: FORCE_NAME_USER_MESSAGE_MAX_LENGTH,
  });
  const privateNoteResult = validateOptionalText(privateNote, {
    maxLength: MODERATOR_NOTE_MAX_LENGTH,
  });

  return {
    ok: policyReasonResult.ok && userMessageResult.ok && privateNoteResult.ok,
    value: {
      policyReason: policyReasonResult.value,
      userMessage: userMessageResult.value,
      privateNote: privateNoteResult.value,
    },
    error: !policyReasonResult.ok
      ? "policy_reason"
      : !userMessageResult.ok
        ? "user_message"
        : !privateNoteResult.ok
          ? "private_note"
          : null,
  };
}

export function validateModeratorNote(value) {
  return withContractError(
    validateOptionalText(value, { maxLength: MODERATOR_NOTE_MAX_LENGTH }),
    "moderator_note",
  );
}
