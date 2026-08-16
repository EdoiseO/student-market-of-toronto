import { AdminAnnouncementsDashboard } from "@/components/admin-announcements-dashboard";
import { requireAdminPageAction } from "@/lib/admin-page-access";
import { MODERATION_ACTIONS } from "@/lib/moderation-policy.mjs";

export default async function AdminAnnouncementsPage() {
  await requireAdminPageAction(
    MODERATION_ACTIONS.manageAnnouncements,
    "announcement operations page",
  );

  return <AdminAnnouncementsDashboard />;
}
