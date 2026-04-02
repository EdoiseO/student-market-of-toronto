"use client";

import * as React from "react";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";
import {
  buildDefaultAvatarUrl,
  getProfileAvatarPreset,
} from "@/lib/profile-avatar";

function useResolvedProfileAvatar({ email, name, avatarPresetId, avatarUrl, initialsOverride }) {
  const initials =
    initialsOverride ??
    (name
      ?.split(" ")
      .map((part) => part[0])
      .join("")
      .slice(0, 2)
      .toUpperCase() || "SM");

  const preset = getProfileAvatarPreset(avatarPresetId);
  const imageUrl = avatarUrl || (!preset ? buildDefaultAvatarUrl(email) : "");

  return {
    imageUrl,
    initials,
    preset,
  };
}

export function ProfileAvatar({
  email,
  name,
  avatarPresetId,
  avatarUrl,
  initialsOverride,
  className,
  imageClassName,
  fallbackClassName,
  size = "default",
}) {
  const { imageUrl, initials, preset } = useResolvedProfileAvatar({
    email,
    name,
    avatarPresetId,
    avatarUrl,
    initialsOverride,
  });
  const showInitials = Boolean(preset) || !imageUrl;

  return (
    <Avatar className={className} size={size}>
      {imageUrl ? (
        <AvatarImage
          src={imageUrl}
          alt={name || "Profile avatar"}
          className={imageClassName}
        />
      ) : null}
      <AvatarFallback
        className={cn(
          preset ? `${preset.className} text-white` : undefined,
          fallbackClassName,
        )}
      >
        {showInitials ? initials : null}
      </AvatarFallback>
    </Avatar>
  );
}

export function ProfileAvatarPreview({
  email,
  name,
  avatarPresetId,
  avatarUrl,
  initialsOverride,
  className,
  initialsClassName,
}) {
  const { imageUrl, initials, preset } = useResolvedProfileAvatar({
    email,
    name,
    avatarPresetId,
    avatarUrl,
    initialsOverride,
  });

  if (imageUrl) {
    return (
      <div
        aria-label={name || "Profile avatar"}
        role="img"
        className={cn("overflow-hidden bg-cover bg-center bg-no-repeat", className)}
        style={{ backgroundImage: `url(${imageUrl})` }}
      />
    );
  }

  return (
    <div
      className={cn(
        "flex items-center justify-center overflow-hidden bg-zinc-100 text-zinc-700",
        preset?.className,
        preset ? "text-white" : undefined,
        className,
      )}
    >
      <span className={cn("font-semibold tracking-tight", initialsClassName)}>{initials}</span>
    </div>
  );
}
