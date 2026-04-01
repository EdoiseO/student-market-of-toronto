export const PROFILE_AVATAR_PRESETS = [
  {
    id: "gradient-sunset",
    label: "Sunset",
    className: "bg-gradient-to-br from-orange-400 via-rose-500 to-pink-600",
  },
  {
    id: "gradient-ocean",
    label: "Ocean",
    className: "bg-gradient-to-br from-sky-400 via-blue-500 to-indigo-600",
  },
  {
    id: "gradient-forest",
    label: "Forest",
    className: "bg-gradient-to-br from-emerald-400 via-teal-500 to-cyan-600",
  },
  {
    id: "gradient-lilac",
    label: "Lilac",
    className: "bg-gradient-to-br from-fuchsia-400 via-violet-500 to-purple-600",
  },
  {
    id: "gradient-gold",
    label: "Gold",
    className: "bg-gradient-to-br from-amber-300 via-orange-400 to-rose-500",
  },
  {
    id: "gradient-lagoon",
    label: "Lagoon",
    className: "bg-gradient-to-br from-teal-300 via-cyan-500 to-sky-600",
  },
  {
    id: "gradient-copper",
    label: "Copper",
    className: "bg-gradient-to-br from-orange-300 via-amber-600 to-stone-700",
  },
  {
    id: "gradient-berry",
    label: "Berry",
    className: "bg-gradient-to-br from-pink-500 via-fuchsia-600 to-violet-700",
  },
  {
    id: "gradient-dusk",
    label: "Dusk",
    className: "bg-gradient-to-br from-slate-500 via-zinc-700 to-neutral-900",
  },
];

const PROFILE_AVATAR_PRESET_ALIASES = {
  "initials-coral": "gradient-sunset",
  "initials-ruby": "gradient-sunset",
  "initials-lagoon": "gradient-ocean",
  "initials-ice": "gradient-ocean",
  "initials-mint": "gradient-forest",
  "initials-berry": "gradient-berry",
  "initials-plum": "gradient-lilac",
  "initials-peach": "gradient-gold",
  "initials-dusk": "gradient-dusk",
};

export function buildDefaultAvatarUrl(email) {
  return email ? `https://avatar.vercel.sh/${encodeURIComponent(email)}` : "";
}

export function getProfileAvatarPreset(presetId) {
  if (!presetId) {
    return null;
  }

  const normalizedPresetId = PROFILE_AVATAR_PRESET_ALIASES[presetId] ?? presetId;

  return PROFILE_AVATAR_PRESETS.find((preset) => preset.id === normalizedPresetId) ?? null;
}
