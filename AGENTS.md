# Student Market of Toronto — Local Agent Notes

## Project status
- Implemented and actively used: authentication, registration, listing creation, listing viewing, listing editing, dashboard listing management.
- Placeholder or not fully implemented yet: search, messages, profile.

## Working rules
- Every time code is changed, create a session log in `logs/<date>-<session-title>.md`.
- Use the current local date in `YYYY-MM-DD` format for the filename.
- Reuse the same log file throughout the session instead of creating multiple logs for one task.
- Each log entry should briefly state what changed, which files were touched, and any validation that was run.
- Never delete the `logs/` directory or existing log files unless the user explicitly asks.
- Keep the current session log updated as work progresses.
- Do not implement search, messages, or profile behavior unless explicitly asked.
- Placeholder UI is allowed, but it should not look broken or misleading.
- Keep changes focused on the requested task; avoid broad refactors.
- Prefer minimal, readable solutions that match the existing codebase style.

## UI conventions
- Reuse existing `shadcn`/UI components and current Tailwind patterns.
- Keep the marketplace/dashboard visual style consistent with existing rounded cards, spacing, and button styles.
- For unfinished features, prefer honest disabled or informational UI over fake interactivity.

## Listing flows
- Listing management lives primarily in the dashboard and listing form components.
- Preserve current listing states unless explicitly asked to change workflow behavior.
- When working on image uploads/previews, make sure both create and edit flows stay consistent.

## Schema notes
- Current app-visible schema is centered around four main tables plus auth and storage.
- Main tables used by the app:
  - `profiles`
  - `listings`
  - `listing_images`
  - `listing_favourites`
- Main storage bucket used by the app:
  - `listing-images`
- Auth is handled through Supabase `auth.users`, while app-facing seller identity is read from `profiles`.

- `profiles`
  - primary key: `id` (`uuid`)
  - fields confirmed from schema screenshot: `first_name`, `last_name`, `school`, `created_at`, `avatar_preset_id`, `avatar_url`, `bio`, `is_public`, `updated_at`
  - one profile row should exist per authenticated user
  - listing detail seller identity depends on this table
  - current profile page/avatar work reads and writes avatar and bio data from this table

- `listings`
  - primary key: `id` (`uuid`)
  - seller link: `seller_id` (`uuid`)
  - confirmed fields in use: `title`, `description`, `price`, `category`, `condition`, `location`, `status`, `created_at`, `updated_at`, `previous_price`, `is_featured`, `is_negotiable`, `view_count`, `slug`
  - `seller_id` links to `profiles.id`

- `listing_images`
  - primary key: `id` (`uuid`)
  - foreign key: `listing_id` (`uuid`)
  - confirmed fields in use: `image_url`, `storage_path`, `position`, `created_at`
  - one listing can have many images
  - images are ordered by `position`

- `listing_favourites`
  - composite relationship table between user and listing
  - confirmed fields in use: `user_id`, `listing_id`, `created_at`
  - `user_id` refers to the authenticated user/profile id
  - used for the favourites tab and favourite toggle behavior

- Relationships
  - `profiles.id` -> `listings.seller_id`
  - `listings.id` -> `listing_images.listing_id`
  - `listings.id` -> `listing_favourites.listing_id`
  - `profiles/auth user id` -> `listing_favourites.user_id`

- Important app assumptions
  - listing cards and detail pages expect `slug` to uniquely identify a listing
  - listing detail seller UI depends on `profiles`, not only `auth.user_metadata`
  - profile avatar presets and custom profile image URLs now belong to `profiles`
  - profile bio and public-profile visibility now belong to `profiles`
  - image display depends on `listing_images.position` order
  - deleting a listing should also remove its `listing_images` rows and storage files where applicable
  - search and dashboard logic assume `status` is meaningful across values like `active`, `inactive`, `draft`, `sold`, and derived dashboard `favourite`

- Known sync rule
  - Keep auth metadata and `profiles` rows in sync so seller names and schools render correctly.
  - Avatar preset, avatar URL, bio, and public-profile visibility should be treated as `profiles` data, not auth metadata.

- Not in schema yet
  - `saved_searches` is not present and should not be assumed.
  - notification-preferences storage is not present yet and should not be assumed.

## RLS and policies
- RLS is enabled and behavior matters for app debugging; do not assume table reads are globally visible.

- `listing_favourites`
  - authenticated users can insert their own favourites
  - authenticated users can delete their own favourites
  - authenticated users can view their own favourites

- `listing_images`
  - authenticated users can view images for their own listings
  - authenticated users can insert images for their own listings
  - authenticated users can update images for their own listings
  - authenticated users can delete images for their own listings
  - public (`anon`, `authenticated`) can view images for active listings

- `listings`
  - authenticated users can view their own listings
  - authenticated users can create their own listings
  - authenticated users can update their own listings
  - authenticated users can delete their own listings
  - public (`anon`, `authenticated`) can view active listings

- `profiles`
  - authenticated users can view profiles
  - insert is enabled for profile creation/upsert flows
  - anonymous users cannot view profiles
  - result: seller identity is visible to logged-in users but should fall back for logged-out users unless policies change

- Policy implication for app behavior
  - public listing pages can show listing content and active listing images without login
  - seller name/school on listing pages depends on `profiles` read access
  - if a logged-in user still sees fallback seller text, check for missing profile rows or stale profile data
  - if a logged-out user sees fallback seller text, that is expected under current `profiles` policy

## Validation
- After code changes, run targeted lint first when practical.
- Run `npm run build` for changes that affect routing, layout, forms, or shared components.

## Git and review workflow
- This project requires approval/review before changes are merged into `main`.
- Do not assume changes should be merged immediately after opening a PR.
- When updating PRs, keep the summary accurate so reviewers can approve with the right context.

## Notes for future work
- If a feature is only partially built, call that out clearly in the final handoff.
- Prefer fixing root-cause UI issues over patching symptoms.
