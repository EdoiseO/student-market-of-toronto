const TORONTO_SCHOOL_EMAIL_DOMAINS = [
  "utoronto.ca",
  "mail.utoronto.ca",
  "torontomu.ca",
  "yorku.ca",
  "my.yorku.ca",
  "georgebrown.ca",
  "mail.georgebrown.ca",
  "senecapolytechnic.ca",
  "myseneca.ca",
  "humber.ca",
  "student.humber.ca",
  "centennialcollege.ca",
  "my.centennialcollege.ca",
  "ocadu.ca",
];

export function normalizeEmail(email = "") {
  return email.trim().toLowerCase();
}

export function getEmailDomain(email = "") {
  const normalizedEmail = normalizeEmail(email);
  const parts = normalizedEmail.split("@");

  return parts.length === 2 ? parts[1] : "";
}

export function isValidTorontoSchoolEmail(email = "") {
  const domain = getEmailDomain(email);

  return TORONTO_SCHOOL_EMAIL_DOMAINS.includes(domain);
}

export function getTorontoSchoolEmailError(email = "") {
  if (!normalizeEmail(email)) {
    return "Enter your Toronto school email.";
  }

  if (!isValidTorontoSchoolEmail(email)) {
    return "Use a valid Toronto school email from a supported school domain.";
  }

  return "";
}

export { TORONTO_SCHOOL_EMAIL_DOMAINS };
