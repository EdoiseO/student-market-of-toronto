import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  MAX_CATALOG_PAGE,
  MAX_SEARCH_QUERY_LENGTH,
  getNearbyPageNumbers,
  normalizeSearchQuery,
  parseCatalogPage,
} from "../src/lib/catalog-pagination.mjs";

const source = (relativePath) =>
  readFile(new URL(`../${relativePath}`, import.meta.url), "utf8");

test("catalog page parsing and link windows remain bounded", () => {
  assert.equal(parseCatalogPage("-2"), 1);
  assert.equal(parseCatalogPage("999999999999"), MAX_CATALOG_PAGE);
  assert.deepEqual(getNearbyPageNumbers(50_000, MAX_CATALOG_PAGE), [49_999, 50_000, 50_001]);
  assert.deepEqual(getNearbyPageNumbers(1, MAX_CATALOG_PAGE, 2), [1, 2, 3]);
  assert.equal(normalizeSearchQuery(`  ${"x".repeat(100)}  `).length, MAX_SEARCH_QUERY_LENGTH);
});

test("authenticated listing writes cannot forge ranking, price-history, or timestamp fields", async () => {
  const [migration, createForm, editForm, dashboardActions] = await Promise.all([
    source("supabase/migrations/20260812233309_enforce_listing_server_managed_fields.sql"),
    source("src/components/create-listing-form.jsx"),
    source("src/components/edit-listing-form.jsx"),
    source("src/components/dashboard-listing-actions.jsx"),
  ]);

  assert.match(migration, /new\.is_featured := false/i);
  assert.match(migration, /new\.view_count := 0/i);
  assert.match(migration, /new\.previous_price := null/i);
  assert.match(migration, /new\.price is distinct from old\.price[\s\S]*new\.previous_price := old\.price/i);
  assert.match(migration, /listing_previous_price_is_server_managed/i);
  assert.match(migration, /integrity_context <> 'retirement'/i);
  assert.match(migration, /new\.price is distinct from old\.price and integrity_context = 'retirement'[\s\S]*new\.previous_price := null/i);
  assert.match(migration, /new\.created_at := pg_catalog\.statement_timestamp\(\)/i);
  assert.match(
    migration,
    /new\.is_featured is distinct from old\.is_featured[\s\S]*new\.view_count is distinct from old\.view_count[\s\S]*new\.created_at is distinct from old\.created_at/i,
  );
  assert.match(migration, /listing_ranking_fields_are_server_managed/i);
  assert.match(migration, /revoke insert, update on table public\.listings from anon, authenticated/i);

  const authenticatedGrantBlock = migration.match(
    /grant insert \([\s\S]*?\) on table public\.listings to authenticated;[\s\S]*?grant update \([\s\S]*?\) on table public\.listings to authenticated;/i,
  )?.[0] ?? "";
  assert.ok(authenticatedGrantBlock);
  assert.doesNotMatch(authenticatedGrantBlock, /\bis_featured\b/i);
  assert.doesNotMatch(authenticatedGrantBlock, /\bview_count\b/i);
  assert.doesNotMatch(authenticatedGrantBlock, /\bcreated_at\b/i);
  assert.doesNotMatch(authenticatedGrantBlock, /\bupdated_at\b/i);
  assert.doesNotMatch(authenticatedGrantBlock, /\bprevious_price\b/i);
  assert.doesNotMatch(createForm, /submitted_for_review_at\s*:/i);
  assert.doesNotMatch(editForm, /previous_price\s*:/i);
  assert.match(dashboardActions, /rpc\("transition_owned_listing_status"/i);
});

test("public catalog routes bound both listing rows and embedded images", async () => {
  const [home, category, categoryAll, search, profile] = await Promise.all([
    source("src/app/page.js"),
    source("src/app/categories/[slug]/page.jsx"),
    source("src/app/categories/[slug]/all/page.jsx"),
    source("src/app/search/page.jsx"),
    source("src/app/profile/[id]/page.jsx"),
  ]);

  assert.match(home, /\.limit\(HOME_SECTION_LIMIT\)/);
  assert.match(home, /\.limit\(LISTING_IMAGE_LIMIT, \{ referencedTable: "listing_images" \}\)/);

  assert.match(category, /rpc\("get_active_category_listing_ids"/);
  assert.match(category, /p_limit: SECTION_CANDIDATE_LIMIT/);
  assert.match(category, /\.limit\(requestedIds\.length\)/);
  assert.match(category, /\.limit\(LISTING_IMAGE_LIMIT, \{ referencedTable: "listing_images" \}\)/);

  assert.match(categoryAll, /select\("id", \{ count: "exact", head: true \}\)/);
  assert.match(categoryAll, /\.range\(startIndex, startIndex \+ ITEMS_PER_PAGE - 1\)/);
  assert.match(categoryAll, /\.limit\(LISTING_IMAGE_LIMIT, \{ referencedTable: "listing_images" \}\)/);

  assert.match(search, /rpc\("search_active_listing_page"/);
  assert.match(search, /p_limit: SEARCH_ITEMS_PER_PAGE/);
  assert.match(search, /\.limit\(SEARCH_ITEMS_PER_PAGE\)/);
  assert.match(search, /<Pagination/);

  assert.match(profile, /select\("id", \{ count: "exact", head: true \}\)/);
  assert.match(profile, /\.range\(pageStart, pageStart \+ PROFILE_LISTINGS_PER_PAGE - 1\)/);
  assert.match(profile, /\.limit\(LISTING_IMAGE_LIMIT, \{ referencedTable: "listing_images" \}\)/);
  assert.match(profile, /<Pagination/);
});

test("public catalog RPCs use indexed filters and enforce hard work caps", async () => {
  const [migration, searchPage, searchForm] = await Promise.all([
    source("supabase/migrations/20260812233309_enforce_listing_server_managed_fields.sql"),
    source("src/app/search/page.jsx"),
    source("src/components/search-form.jsx"),
  ]);

  assert.match(
    migration,
    /create or replace function public\.search_active_listing_page[\s\S]*security invoker[\s\S]*candidate_limit constant integer := 1201/i,
  );
  assert.match(migration, /pg_catalog\.left\([\s\S]*p_query[\s\S]*80/i);
  assert.match(migration, /create extension if not exists pg_trgm with schema extensions/i);
  assert.match(migration, /using gin \(catalog_search_text extensions\.gin_trgm_ops\)/i);
  assert.match(migration, /using gin \(catalog_search_vector\)/i);
  assert.match(migration, /with horizon_scan as materialized[\s\S]*order by listing\.created_at desc, listing\.id asc[\s\S]*limit \$7[\s\S]*candidates as materialized/i);
  assert.match(migration, /from horizon_scan listing[\s\S]*where listing\.horizon_ordinal <= 1200/i);
  assert.match(migration, /result_counts\.matched_count/i);
  assert.match(migration, /result_counts\.scanned_count > 1200/i);
  assert.match(migration, /page_offset integer := least\([\s\S]*1200/i);
  assert.match(
    migration,
    /create or replace function public\.get_active_category_listing_ids[\s\S]*security invoker[\s\S]*limit least\(greatest\(coalesce\(p_limit, 6\), 1\), 24\)/i,
  );
  assert.match(migration, /pg_catalog\.array_ndims\(p_categories\)[\s\S]*pg_catalog\.cardinality\(p_categories\), 0\) > 16/i);
  assert.match(migration, /listings_active_category_created_idx[\s\S]*\(category, created_at desc, id asc\)/i);
  assert.match(
    migration,
    /requested_categories as materialized[\s\S]*cross join lateral[\s\S]*order by listing\.created_at desc, listing\.id asc[\s\S]*limit 96[\s\S]*from category_horizon candidate[\s\S]*candidate\.view_count::numeric/i,
  );
  assert.match(migration, /listing\.retired_at is null/i);
  assert.match(searchPage, /normalizeSearchQuery\(resolvedSearchParams\?\.q\)/);
  assert.match(searchPage, /is_count_capped/);
  assert.match(searchPage, /Results within the 1,200 newest active listings\./);
  assert.match(searchForm, /maxLength=\{MAX_SEARCH_QUERY_LENGTH\}/);
});

test("listing images are transactionally owner-bound and capped at ten", async () => {
  const [migration, editForm, adminListing, adminReport, messages, conversation] =
    await Promise.all([
      source("supabase/migrations/20260812233309_enforce_listing_server_managed_fields.sql"),
      source("src/components/edit-listing-form.jsx"),
      source("src/app/admin/listings/[listingId]/page.jsx"),
      source("src/app/admin/reports/[reportId]/page.jsx"),
      source("src/app/messages/page.jsx"),
      source("src/app/messages/[conversationId]/page.jsx"),
    ]);

  assert.match(migration, /check \(position is not null and position between 0 and 9\)/i);
  assert.match(migration, /existing_listing_image_limit_exceeded/i);
  assert.match(migration, /existing_listing_image_integrity_violation/i);
  assert.match(migration, /where listing\.id = any\(array\[new\.listing_id, old\.listing_id\]\)[\s\S]*for update/i);
  assert.match(migration, /caller_id <> new_listing_owner[\s\S]*caller_id <> old_listing_owner/i);
  assert.match(migration, /split_part\(new\.storage_path, '\/', 1\) <> new_listing_owner::text/i);
  assert.match(migration, /object\.bucket_id = 'listing-images'[\s\S]*object\.owner_id = caller_id::text/i);
  assert.match(migration, /if current_image_count >= 10/i);
  assert.match(migration, /before insert or update of listing_id, storage_path, image_url, position/i);

  const deleteIndex = editForm.indexOf('.from("listing_images")\n        .delete()');
  const insertIndex = editForm.indexOf('.from("listing_images")\n        .insert(');
  assert.ok(deleteIndex >= 0 && insertIndex > deleteIndex);
  assert.match(editForm, /Upload replacements first while the old metadata and blobs remain fully[\s\S]*uploadedImages\.push/i);
  assert.match(editForm, /restoreRemovedPhotoRows\(\)/);
  assert.match(editForm, /Old blobs[\s\S]*remain in Storage until all replacement rows and ordering updates succeed/i);
  const replacementInsertIndex = editForm.indexOf("for (const uploadedImage of uploadedImages)");
  const oldStorageDeleteIndex = editForm.indexOf("const removedStoragePaths = removedPhotos");
  assert.ok(replacementInsertIndex >= 0 && oldStorageDeleteIndex > replacementInsertIndex);

  assert.match(adminListing, /limit\(LISTING_IMAGE_LIMIT, \{ referencedTable: "listing_images" \}\)/);
  assert.match(adminReport, /limit\(MESSAGE_LISTING_IMAGE_LIMIT, \{ referencedTable: "listings\.listing_images" \}\)/);
  assert.match(adminReport, /limit\(MESSAGE_LISTING_IMAGE_LIMIT, \{ referencedTable: "listing_images" \}\)/);
  assert.match(messages, /limit\(MESSAGE_LISTING_IMAGE_LIMIT, \{ referencedTable: "listings\.listing_images" \}\)/);
  assert.match(conversation, /limit\(MESSAGE_LISTING_IMAGE_LIMIT, \{ referencedTable: "listings\.listing_images" \}\)/);
});

test("later listing migration preserves message-media private schema resolution", async () => {
  const [messageMediaUsageMigration, listingMigration] = await Promise.all([
    source("supabase/migrations/20260812142916_grant_message_media_storage_policy_schema_usage.sql"),
    source("supabase/migrations/20260812233309_enforce_listing_server_managed_fields.sql"),
  ]);

  assert.match(messageMediaUsageMigration, /grant usage on schema private to authenticated/i);
  assert.match(listingMigration, /revoke usage on schema private from public, anon, service_role/i);
  assert.match(listingMigration, /grant usage on schema private to authenticated/i);
  assert.doesNotMatch(listingMigration, /revoke (?:all|usage) on schema private from[^;]*authenticated/i);
});
