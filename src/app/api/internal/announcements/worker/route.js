import { NextResponse } from "next/server";

import { runAnnouncementWorkerPass } from "@/lib/announcement-delivery-worker.mjs";
import { createAdminClient } from "@/lib/supabase-admin";

export const maxDuration = 60;

function json(payload, status = 200) {
  return NextResponse.json(payload, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

async function runWorker(request) {
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret) {
    return json({ error: "Announcement worker is not configured." }, 503);
  }

  if (request.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return json({ error: "Unauthorized." }, 401);
  }

  const admin = createAdminClient();

  if (!admin) {
    return json({ error: "Announcement worker is not configured." }, 503);
  }

  try {
    const result = await runAnnouncementWorkerPass({ admin });
    return json({ ok: true, ...result });
  } catch (error) {
    console.error("Announcement worker pass failed:", error?.message ?? error);
    return json({ error: "Announcement worker could not complete this pass." }, 500);
  }
}

export async function GET(request) {
  return runWorker(request);
}

export async function POST(request) {
  return runWorker(request);
}
