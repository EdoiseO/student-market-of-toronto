# Student Market of Toronto

Student Market of Toronto is a marketplace web app for Toronto students to browse, create, manage, and favourite listings in one place.

It is built with Next.js, Supabase, and a component system based on `shadcn` UI patterns.

## Current Status

### Implemented
- Student registration and login with Supabase Auth
- Toronto school email validation during registration
- Public listing browsing on the home page and category pages
- Listing detail pages with image carousel and similar listings
- Listing creation with photo uploads
- Listing editing with photo management and previews
- Dashboard listing management for active, inactive, draft, sold, and favourite states
- Reversible sold flow (`Mark as Sold` and `Reopen Listing`)
- Logged-in sidebar navigation grouped by marketplace, selling, buying, and account tasks

### Placeholder / Not Fully Built Yet
- Search
- Messages
- Profile

Those features may appear in the UI, but they are not fully implemented yet.

## Feature Highlights

### Authentication
- Email/password login with Supabase
- Registration restricted to supported Toronto school email domains
- School name auto-filled from email domain where supported
- Route protection for dashboard and listing management pages

### Listings
- Create listings with title, category, price, description, condition, campus, and negotiable state
- Upload multiple listing photos
- Preview and remove selected images before saving
- Edit existing listings and manage both current and newly added photos
- Browse active listings by category
- View similar listings on detail pages

### Dashboard
- View listings by status: all, active, inactive, sold, draft, and favourite
- Mark active listings as sold
- Reopen sold listings back to active
- Delete listings and associated uploaded images

## Tech Stack

- `Next.js 16` with the App Router
- `React 19`
- `Supabase` for auth, database, and storage
- `Tailwind CSS 4`
- `lucide-react`
- `Embla Carousel`

## Getting Started

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment variables

Copy the example env file:

```bash
cp .env.example .env.local
```

Add your Supabase values to `.env.local`:

```env
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY=
```

### 3. Run the development server

```bash
npm run dev
```

Open `http://localhost:3000` in your browser.

## Available Scripts

```bash
npm run dev
npm run build
npm run start
npm run lint
```

## Main Routes

- `/` — browse listings across marketplace sections
- `/categories/[slug]` — browse listings within a category
- `/listings/[slug]` — view a listing
- `/listings/create` — create a new listing
- `/listings/[slug]/edit` — edit an existing listing
- `/dashboard` — manage your listings and favourites
- `/login` — sign in
- `/register` — create an account

## Supported School Email Domains

Registration currently recognizes Toronto school domains for institutions such as:

- University of Toronto
- Toronto Metropolitan University
- York University
- George Brown College
- Humber Polytechnic
- Seneca Polytechnic
- Centennial College
- OCAD University

The email-domain validation logic lives in `src/lib/school-email.js`.

## Project Structure

```text
src/app                 App routes and pages
src/components          Shared UI and feature components
src/lib                 Helpers, category data, mock data, school email rules
src/utils/supabase      Client/server Supabase helpers
public                  Static assets
```

## Development Notes

- This project is currently focused on auth and listing management workflows
- Search, messages, and profile are intentionally not complete yet
- UI for unfinished features should feel intentional, not broken

## Validation

Before pushing changes, the most useful checks are:

```bash
npm run lint
npm run build
```

## Roadmap Ideas

- Real search experience
- Messaging between buyers and sellers
- User profile page
- Better seller identity and trust signals
- More advanced listing filters and sorting
- Saved search and notifications

## License

This project currently does not include a license file.
