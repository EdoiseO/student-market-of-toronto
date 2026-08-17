import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

const [
  skeletons,
  reportsLoading,
  listingsLoading,
  auditLoading,
  enforcementLoading,
  userDetailLoading,
] = await Promise.all([
  read("../src/components/skeletons/admin-dashboard-skeleton.jsx"),
  read("../src/app/admin/reports/loading.jsx"),
  read("../src/app/admin/listings/loading.jsx"),
  read("../src/app/admin/audit/loading.jsx"),
  read("../src/app/admin/enforcement/loading.jsx"),
  read("../src/app/admin/users/[userId]/loading.jsx"),
]);

test("new bounded admin registries use route-specific list skeletons", () => {
  assert.match(skeletons, /export function AdminBoundedRecordsSkeleton/);
  assert.match(skeletons, /max-w-\[1100px\]/);
  assert.match(reportsLoading, /AdminBoundedRecordsSkeleton/);
  assert.match(reportsLoading, /filterVariant="reports"/);
  assert.match(listingsLoading, /AdminBoundedRecordsSkeleton/);
  assert.match(listingsLoading, /filterVariant="listings"/);
  assert.match(auditLoading, /AdminBoundedRecordsSkeleton/);
  assert.match(auditLoading, /rows=\{7\}/);
});

test("report loading follows the evidence, notes, context, and decision hierarchy", () => {
  const reportWorkspaceIndex = skeletons.indexOf("function AdminReportWorkspaceSkeleton");
  const evidenceColumnIndex = skeletons.indexOf("min-w-0 space-y-5 xl:space-y-6", reportWorkspaceIndex);
  const evidenceViewportIndex = skeletons.indexOf("xl:h-[clamp(28rem,60vh,34rem)]", evidenceColumnIndex);
  const contextColumnIndex = skeletons.indexOf('<div className="space-y-5 xl:space-y-6">', evidenceViewportIndex);
  const decisionDetailsIndex = skeletons.indexOf("function AdminDecisionDetailsSkeleton", contextColumnIndex);
  const reportSkeletonIndex = skeletons.indexOf("export function AdminReportReviewSkeleton", decisionDetailsIndex);

  assert.ok(
    reportWorkspaceIndex >= 0
      && reportWorkspaceIndex < evidenceColumnIndex
      && evidenceColumnIndex < evidenceViewportIndex
      && evidenceViewportIndex < contextColumnIndex
      && contextColumnIndex < decisionDetailsIndex
      && decisionDetailsIndex < reportSkeletonIndex,
    "report skeleton must mirror the current two-column review hierarchy",
  );
  assert.match(
    skeletons.slice(reportSkeletonIndex),
    /<AdminReportWorkspaceSkeleton \/>[\s\S]*<AdminDecisionDetailsSkeleton \/>/,
  );
});

test("interactive moderation loading states expose busy semantics", () => {
  assert.match(enforcementLoading, /aria-busy="true"/);
  assert.match(enforcementLoading, /aria-label="Loading enforcement"/);
  assert.match(userDetailLoading, /aria-busy="true"/);
  assert.match(userDetailLoading, /aria-label="Loading user details"/);
});
