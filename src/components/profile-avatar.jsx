"use client";

import * as React from "react";
import Image from "next/image";
import { useLanguage } from "@/context/LanguageContext";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { REMOTE_IMAGE_BLUR_DATA_URL } from "@/lib/image-config";
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

function OptimizedAvatarImage({ imageUrl, alt, className, onError }) {
  if (!imageUrl) {
    return null;
  }

  return (
    <Image
      src={imageUrl}
      alt={alt}
      width={120}
      height={120}
      sizes="(max-width: 1023px) 80px, 120px"
      placeholder="blur"
      blurDataURL={REMOTE_IMAGE_BLUR_DATA_URL}
      onError={onError}
      className={cn("absolute inset-0 h-full w-full object-cover", className)}
    />
  );
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
  const { t } = useLanguage();
  const { imageUrl, initials, preset } = useResolvedProfileAvatar({
    email,
    name,
    avatarPresetId,
    avatarUrl,
    initialsOverride,
  });
  const [failedImageUrl, setFailedImageUrl] = React.useState("");
  const visibleImageUrl = imageUrl && imageUrl !== failedImageUrl ? imageUrl : "";

  return (
    <Avatar
      className={cn("max-h-20 max-w-20 lg:max-h-[120px] lg:max-w-[120px]", className)}
      size={size}
    >
      <AvatarFallback
        aria-hidden={Boolean(visibleImageUrl)}
        className={cn(
          preset ? `${preset.className} text-white` : undefined,
          fallbackClassName,
        )}
      >
        {initials}
      </AvatarFallback>
      <OptimizedAvatarImage
        key={visibleImageUrl}
        imageUrl={visibleImageUrl}
        alt={name || t.profileAvatarLabel}
        className={imageClassName}
        onError={() => setFailedImageUrl(imageUrl)}
      />
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
  const { t } = useLanguage();
  const { imageUrl, initials, preset } = useResolvedProfileAvatar({
    email,
    name,
    avatarPresetId,
    avatarUrl,
    initialsOverride,
  });
  const [failedImageUrl, setFailedImageUrl] = React.useState("");
  const visibleImageUrl = imageUrl && imageUrl !== failedImageUrl ? imageUrl : "";

  if (visibleImageUrl) {
    return (
      <div className={cn("relative flex items-center justify-center overflow-hidden bg-zinc-100 text-zinc-700 dark:bg-muted dark:text-foreground", className)}>
        <span aria-hidden="true" className={cn("font-semibold tracking-tight", initialsClassName)}>{initials}</span>
        <OptimizedAvatarImage
          key={visibleImageUrl}
          imageUrl={visibleImageUrl}
          alt={name || t.profileAvatarLabel}
          onError={() => setFailedImageUrl(imageUrl)}
        />
      </div>
    );
  }

  return (
    <div
      className={cn(
        "flex items-center justify-center overflow-hidden bg-zinc-100 text-zinc-700 dark:bg-muted dark:text-foreground",
        preset?.className,
        preset ? "text-white" : undefined,
        className,
      )}
    >
      <span className={cn("font-semibold tracking-tight", initialsClassName)}>{initials}</span>
    </div>
  );
}
