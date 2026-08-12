-- The reconciliation migration disconnects the legacy workflow. Drop the
-- leftover trigger function too so it cannot be reattached and no longer
-- appears as a mutable-search-path function in the security advisor.
drop function if exists public.enforce_listing_review_workflow();
