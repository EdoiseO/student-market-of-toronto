"use client";

import * as React from "react";

function getDateTimeFormatOptions(variant) {
  if (variant === "date") {
    return {
      month: "short",
      day: "numeric",
    };
  }

  return {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  };
}

function formatDateTime(dateString, language, variant) {
  return new Intl.DateTimeFormat(
    language === "fr" ? "fr-CA" : "en-CA",
    getDateTimeFormatOptions(variant),
  ).format(new Date(dateString));
}

export function ClientFormattedDateTime({ value, language, className, variant = "dateTime" }) {
  const [formattedValue, setFormattedValue] = React.useState("");

  React.useEffect(() => {
    if (!value) {
      setFormattedValue("");
      return;
    }

    setFormattedValue(formatDateTime(value, language, variant));
  }, [language, value, variant]);

  return (
    <time dateTime={value} className={className} suppressHydrationWarning>
      {formattedValue}
    </time>
  );
}
