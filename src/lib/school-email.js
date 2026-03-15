const TORONTO_SCHOOL_EMAIL_DOMAIN_MAP = {
  "utoronto.ca": "University of Toronto",
  "mail.utoronto.ca": "University of Toronto",
  "torontomu.ca": "Toronto Metropolitan University",
  "yorku.ca": "York University",
  "my.yorku.ca": "York University",
  "georgebrown.ca": "George Brown College",
  "mail.georgebrown.ca": "George Brown College",
  "senecapolytechnic.ca": "Seneca Polytechnic",
  "myseneca.ca": "Seneca Polytechnic",
  "humber.ca": "Humber Polytechnic",
  "student.humber.ca": "Humber Polytechnic",
  "centennialcollege.ca": "Centennial College",
  "my.centennialcollege.ca": "Centennial College",
  "ocadu.ca": "OCAD University",
};

const TORONTO_SCHOOL_EMAIL_DOMAINS = Object.keys(TORONTO_SCHOOL_EMAIL_DOMAIN_MAP);

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

export function getTorontoSchoolNameFromEmail(email = "") {
  const domain = getEmailDomain(email);

  return TORONTO_SCHOOL_EMAIL_DOMAIN_MAP[domain] ?? "";
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

export { TORONTO_SCHOOL_EMAIL_DOMAIN_MAP, TORONTO_SCHOOL_EMAIL_DOMAINS };
