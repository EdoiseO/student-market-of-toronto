# Student Market of Toronto

This README is focused on one thing: getting the project running locally.

## What You Need

Before starting the app, make sure you have:

- `Node.js`
- `npm`
- A `Supabase` project

## Supabase Requirements

This project depends on Supabase for:

- authentication
- database reads and writes
- image storage

Your Supabase project should already have the resources this app expects.

### Database tables used by the app

- `profiles`
- `listings`
- `listing_images`
- `listing_favourites`

### Storage bucket used by the app

- `listing-images`
- `profile-images`

If those tables or the storage bucket do not exist in your Supabase project, parts of the app will not work correctly.

## Environment Variables

Copy the example env file:

```bash
cp .env.example .env.local
```

Then add your Supabase values to `.env.local`:

```env
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY=
```

These values come from your Supabase project settings.

## Install Dependencies

```bash
npm install
```

## Run the Project in Development

Start the dev server:

```bash
npm run dev
```

Then open:

```text
http://localhost:3000
```

## Other Useful Commands

Run lint:

```bash
npm run lint
```

Create a production build:

```bash
npm run build
```

Run the production build locally:

```bash
npm run start
```

## What Works Right Now

- registration
- login
- light/dark theme switching
- browsing listings
- category pages
- listing detail pages
- create listing
- edit listing
- dashboard listing management
- dashboard profile and settings pages
- protected seller profile pages for signed-in users

## Features Not Fully Implemented Yet

- search
- messages
- notification settings persistence and most account-level settings beyond theme and listing-page bio visibility

Those features may still appear in the UI, but they are not fully built yet.

## Main Routes

- `/`
- `/categories/[slug]`
- `/listings/[slug]`
- `/profile/[id]`
- `/listings/create`
- `/listings/[slug]/edit`
- `/dashboard`
- `/dashboard/profile`
- `/dashboard/settings`
- `/login`
- `/register`

## Project Structure

```text
src/app                 Routes and pages
src/components          Shared and feature components
src/lib                 Helpers and app data
src/utils/supabase      Supabase client/server setup
public                  Static assets
```

## Notes

- This app is built with `Next.js`, `React`, `Tailwind CSS`, and `Supabase`.
- Registration includes Toronto school email validation.
- Listing image uploads use Supabase Storage.
