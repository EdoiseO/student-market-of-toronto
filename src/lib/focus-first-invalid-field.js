const INVALID_FIELD_SELECTOR = [
  '[aria-invalid="true"]',
  "input:invalid",
  "select:invalid",
  "textarea:invalid",
  '[data-field-invalid="true"] input',
  '[data-field-invalid="true"] select',
  '[data-field-invalid="true"] textarea',
  '[data-field-invalid="true"] button',
  '[data-invalid="true"] input',
  '[data-invalid="true"] select',
  '[data-invalid="true"] textarea',
  '[data-invalid="true"] button',
].join(",");

function focusInvalidField(form) {
  if (!form || typeof form.querySelector !== "function") {
    return false;
  }

  const field = form.querySelector(INVALID_FIELD_SELECTOR);

  if (!field || typeof field.focus !== "function") {
    return false;
  }

  field.focus({ preventScroll: true });

  if (typeof field.scrollIntoView === "function") {
    field.scrollIntoView({ behavior: "smooth", block: "center", inline: "nearest" });
  }

  return true;
}

export function focusFirstInvalidField(form, { defer = true } = {}) {
  if (defer && typeof requestAnimationFrame === "function") {
    requestAnimationFrame(() => focusInvalidField(form));
    return true;
  }

  return focusInvalidField(form);
}

export { INVALID_FIELD_SELECTOR };
