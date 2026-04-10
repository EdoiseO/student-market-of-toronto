"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { useState } from "react"

import { createClient } from "@/utils/supabase/client"

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { useLanguage } from "@/context/LanguageContext"
import {
  LISTING_APPROVAL_STATUS_VALUES,
  isListingApprovalSetupMissing,
  isPendingListingApproval,
} from "@/lib/listing-approval"
import { translations } from "@/lib/translations"

export function DashboardListingActions({
  id,
  slug,
  status,
  submittedForReviewAt = null,
  moderationReviewedAt = null,
}) {
  const router = useRouter()
  const supabase = createClient()
  const { language } = useLanguage()
  const t = translations[language]
  const [isUpdatingStatus, setIsUpdatingStatus] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false)
  const isPendingReview = isPendingListingApproval({
    status,
    submittedForReviewAt,
    moderationReviewedAt,
  })
  const canEditListing = !isPendingReview
  const canSubmitForReview =
    status === "draft" || status === LISTING_APPROVAL_STATUS_VALUES.rejected
  const canMarkAsSold = status === "active"
  const canReopenListing = status === "sold"

  async function handleUpdateStatus(nextStatus) {
    setIsUpdatingStatus(true)

    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      setIsUpdatingStatus(false)
      router.push("/login")
      return
    }

    const nextValues = { status: nextStatus }

    if (nextStatus === LISTING_APPROVAL_STATUS_VALUES.pendingReview) {
      Object.assign(nextValues, {
        submitted_for_review_at: new Date().toISOString(),
      })
    }

    const { error } = await supabase
      .from("listings")
      .update(nextValues)
      .eq("id", id)
      .eq("seller_id", user.id)

    setIsUpdatingStatus(false)

    if (error) {
      if (isListingApprovalSetupMissing(error)) {
        console.error("Listing approval setup is incomplete:", error.message)
      } else {
        console.error("Failed to update listing status:", error.message)
      }
      return
    }

    router.refresh()
  }

  async function handleDelete() {
    setIsDeleting(true)

    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      setIsDeleting(false)
      setIsDeleteDialogOpen(false)
      router.push("/login")
      return
    }

    const { data: images, error: imagesError } = await supabase
      .from("listing_images")
      .select("storage_path")
      .eq("listing_id", id)

    if (imagesError) {
      console.error("Failed to load listing images before delete:", imagesError.message)
      setIsDeleting(false)
      return
    }

    const imagePaths = (images ?? [])
      .map((image) => image.storage_path)
      .filter(Boolean)

    if (imagePaths.length > 0) {
      const { error: storageError } = await supabase.storage
        .from("listing-images")
        .remove(imagePaths)

      if (storageError) {
        console.error("Failed to remove listing image files:", storageError.message)
        setIsDeleting(false)
        return
      }
    }

    const { error: deleteError } = await supabase
      .from("listings")
      .delete()
      .eq("id", id)
      .eq("seller_id", user.id)

    setIsDeleting(false)

    if (deleteError) {
      console.error("Failed to delete listing:", deleteError.message)
      return
    }

    setIsDeleteDialogOpen(false)
    router.refresh()
  }

  return (
    <div className="flex flex-wrap items-center justify-end gap-1.5 whitespace-nowrap md:ml-auto md:flex-nowrap">
      {canEditListing ? (
        <Button
          asChild
          variant="outline"
          size="xs"
          className="h-8 rounded-lg bg-white px-2.5 dark:bg-background"
        >
          <Link href={`/listings/${slug}/edit`}>{t.editListing}</Link>
        </Button>
      ) : null}
      {canSubmitForReview ? (
        <Button
          type="button"
          variant="outline"
          size="xs"
          className="h-8 rounded-lg bg-white px-2.5 dark:bg-background"
          onClick={() => handleUpdateStatus(LISTING_APPROVAL_STATUS_VALUES.pendingReview)}
          disabled={isUpdatingStatus}
        >
          {isUpdatingStatus
            ? t.saving
            : status === LISTING_APPROVAL_STATUS_VALUES.rejected
              ? t.resubmitForReview
              : t.submitForReview}
        </Button>
      ) : null}
      {canMarkAsSold ? (
        <Button
          type="button"
          variant="outline"
          size="xs"
          className="h-8 rounded-lg bg-white px-2.5 dark:bg-background"
          onClick={() => handleUpdateStatus("sold")}
          disabled={isUpdatingStatus}
        >
          {isUpdatingStatus ? t.saving : t.markAsSold}
        </Button>
      ) : null}
      {canReopenListing ? (
        <Button
          type="button"
          variant="outline"
          size="xs"
          className="h-8 rounded-lg bg-white px-2.5 dark:bg-background"
          onClick={() => handleUpdateStatus("active")}
          disabled={isUpdatingStatus}
        >
          {isUpdatingStatus ? t.saving : t.reopenListing}
        </Button>
      ) : null}
      <AlertDialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
        <AlertDialogTrigger asChild>
          <Button
            type="button"
            variant="outline"
            size="xs"
            className="h-8 rounded-lg border-rose-200 bg-rose-50 px-2.5 text-rose-700 hover:bg-rose-100 dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-300 dark:hover:bg-rose-950/60"
          >
            {t.delete}
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t.deleteThisListing}</AlertDialogTitle>
            <AlertDialogDescription>
              {t.deleteListingDescription}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>{t.cancel}</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} disabled={isDeleting}>
              {isDeleting ? t.deleting : t.deleteListing}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
