import assert from "node:assert/strict";
import test from "node:test";
import { getAdminQueueReturnHref, adminReviewHref } from "../src/lib/admin-queue-navigation.mjs";

test("review links retain queue filters, pagination and selected record", () => {
  const queue = "/admin/listings?status=rejected&q=wood&page=3";
  const detail = new URL(adminReviewHref("/admin/listings/123", queue, "123"), "https://market.test");
  assert.equal(getAdminQueueReturnHref(detail.searchParams.get("returnTo"), "/admin/listings"), `${queue}#record-123`);
  assert.equal(getAdminQueueReturnHref("/admin/users", "/admin/users"), "/admin/users");
});

test("review return targets cannot leave their authorized queue", () => {
  for (const input of ["https://evil.test/admin/listings", "//evil.test/admin/listings", "/admin/users", "/admin/listings/123", "/admin/listings/../users", "/\\evil.test/admin/listings", "javascript:alert(1)", null, ["/admin/listings"], "/admin/listings\n?x=1", "/admin/listings?" + "a".repeat(1801)]) {
    assert.equal(getAdminQueueReturnHref(input, "/admin/listings"), "/admin/listings");
  }
});
