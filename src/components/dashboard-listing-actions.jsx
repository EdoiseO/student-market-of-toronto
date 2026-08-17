"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { useRef, useState } from "react"
import { EllipsisIcon } from "lucide-react"
import { toast } from "sonner"

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
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet"
import { useLanguage } from "@/context/LanguageContext"
import {
  LISTING_APPROVAL_STATUS_VALUES,
  isListingApprovalSetupMissing,
  isPendingListingApproval,
} from "@/lib/listing-approval"
import {
  hasConflictingUnresolvedListingWrite,
  isAmbiguousListingWriteError,
  OWNED_LISTING_STATUS_ACTIONS,
  parseListingRequiredFieldViolation,
  replayAmbiguousListingWrite,
  shouldRetainUnresolvedListingWrite,
} from "@/lib/listing-integrity.mjs"
import {
  LISTING_WRITE_ACTIONS,
  abortOwnedListingWriteIntent,
  clearListingWriteJournal,
  drainOwnedListingImageCleanup,
  hashListingWriteSignature,
  listingWriteJournalKey,
  prepareListingWriteJournal,
} from "@/lib/listing-write-recovery.mjs"
import { translations } from "@/lib/translations"

export function DashboardListingActions({
  id,
  slug,
  title = "",
  status,
  contentRevision = 1,
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
  const [isActionSheetOpen, setIsActionSheetOpen] = useState(false)
  const pendingStatusOperationRef = useRef(null)
  const pendingRetirementOperationRef = useRef(null)
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

  async function handleUpdateStatus(action) {
    setIsActionSheetOpen(false)
    setIsUpdatingStatus(true)

    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      setIsUpdatingStatus(false)
      router.push("/login")
      return
    }

    if (pendingRetirementOperationRef.current) {
      setIsUpdatingStatus(false)
      toast.error(t.errorGeneric)
      return
    }

    if (hasConflictingUnresolvedListingWrite(pendingStatusOperationRef.current, action)) {
      setIsUpdatingStatus(false)
      toast.error(t.errorGeneric)
      return
    }
    if (pendingStatusOperationRef.current?.action !== action) {
      pendingStatusOperationRef.current = {
        action,
        signature: action,
        operationId: crypto.randomUUID(),
        unresolvedDbOperation: null,
      }
    }
    const operation = pendingStatusOperationRef.current
    const statusWrite = await replayAmbiguousListingWrite(() => supabase.rpc(
      "transition_owned_listing_status_idempotent",
      {
        p_operation_id: operation.operationId,
        p_listing_id: id,
        p_action: action,
      },
    ))
    const { error } = statusWrite

    setIsUpdatingStatus(false)

    if (error) {
      const unresolvedStatus = shouldRetainUnresolvedListingWrite(
        operation,
        "transition",
        statusWrite,
      )
      operation.unresolvedDbOperation = unresolvedStatus ? "transition" : null
      if (!unresolvedStatus && !isAmbiguousListingWriteError(error)) {
        pendingStatusOperationRef.current = null
      }
      if (isListingApprovalSetupMissing(error)) {
        console.error("Listing approval setup is incomplete:", error.message)
        toast.error(t.listingApprovalSetupRequired)
      } else if (parseListingRequiredFieldViolation(error).length > 0) {
        toast.error(t.listingRequiredFieldsUnavailable)
      } else {
        console.error("Failed to update listing status:", error.message)
        toast.error(t.errorGeneric)
      }
      return
    }

    operation.unresolvedDbOperation = null
    pendingStatusOperationRef.current = null
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

    if (pendingStatusOperationRef.current) {
      setIsDeleting(false)
      toast.error(t.errorGeneric)
      return
    }

    const signatureHash = await hashListingWriteSignature(JSON.stringify({
      action: LISTING_WRITE_ACTIONS.retire,
      listingId: id,
      contentRevision,
    }))
    const journalKey = listingWriteJournalKey(LISTING_WRITE_ACTIONS.retire, id)
    const imageBucket = supabase.storage.from("listing-images")
    const prepared = await prepareListingWriteJournal({
      supabase,
      bucket: imageBucket,
      storage: globalThis.localStorage,
      key: journalKey,
      action: LISTING_WRITE_ACTIONS.retire,
      signatureHash,
      listingId: id,
      expectedContentRevision: contentRevision,
    })
    if (prepared.error) {
      console.error("Failed to prepare listing retirement:", prepared.error.message)
      setIsDeleting(false)
      toast.error(t.errorGeneric)
      return
    }
    if (prepared.previousCompleted) {
      pendingRetirementOperationRef.current = null
      setIsDeleting(false)
      setIsDeleteDialogOpen(false)
      router.refresh()
      return
    }

    const operation = prepared.entry
    pendingRetirementOperationRef.current = operation
    const retireWrite = await replayAmbiguousListingWrite(() => supabase.rpc(
      "commit_owned_listing_retire_intent",
      {
        p_operation_id: operation.operationId,
        p_signature_hash: signatureHash,
      },
    ))
    if (retireWrite.error) {
      if (!retireWrite.hadAmbiguousAttempt) {
        const aborted = await abortOwnedListingWriteIntent(
          supabase,
          operation.operationId,
          signatureHash,
        )
        if (!aborted.error) {
          clearListingWriteJournal(
            globalThis.localStorage,
            journalKey,
            operation.operationId,
          )
          pendingRetirementOperationRef.current = null
        }
      }
      console.error("Failed to retire listing:", retireWrite.error.message)
      setIsDeleting(false)
      toast.error(t.errorGeneric)
      return
    }

    const cleanupResult = await drainOwnedListingImageCleanup({
      supabase,
      bucket: imageBucket,
    })
    if (cleanupResult.error) {
      console.error("Failed to remove retired listing image files:", cleanupResult.error.message)
      setIsDeleting(false)
      toast.error(t.errorGeneric)
      return
    }

    clearListingWriteJournal(globalThis.localStorage, journalKey, operation.operationId)
    pendingRetirementOperationRef.current = null
    setIsDeleting(false)
    setIsDeleteDialogOpen(false)
    router.refresh()
  }

  return (
    <AlertDialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
      <div className="md:hidden">
        <Sheet open={isActionSheetOpen} onOpenChange={setIsActionSheetOpen}>
          <SheetTrigger asChild>
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="size-11 rounded-full bg-white dark:bg-background"
              aria-label={t.actions}
            >
              <EllipsisIcon className="size-5" />
            </Button>
          </SheetTrigger>
          <SheetContent
            side="bottom"
            className="rounded-t-3xl px-4 pb-[calc(1rem+env(safe-area-inset-bottom))] pt-2"
          >
            <div className="mx-auto h-1.5 w-12 rounded-full bg-muted" aria-hidden="true" />
            <SheetHeader className="px-0 pb-2 pt-3 text-left">
              <SheetTitle className="text-lg font-semibold">{t.actions}</SheetTitle>
              <SheetDescription className="line-clamp-1">{title}</SheetDescription>
            </SheetHeader>
            <div className="flex flex-col gap-3">
              {canEditListing ? (
                <Button asChild variant="outline" className="w-full justify-start px-4">
                  <Link href={`/listings/${slug}/edit`}>{t.editListing}</Link>
                </Button>
              ) : null}
              {canSubmitForReview ? (
                <Button
                  type="button"
                  variant="outline"
                  className="w-full justify-start px-4"
                  onClick={() => handleUpdateStatus(OWNED_LISTING_STATUS_ACTIONS.submitForReview)}
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
                  className="w-full justify-start px-4"
                  onClick={() => handleUpdateStatus(OWNED_LISTING_STATUS_ACTIONS.markSold)}
                  disabled={isUpdatingStatus}
                >
                  {isUpdatingStatus ? t.saving : t.markAsSold}
                </Button>
              ) : null}
              {canReopenListing ? (
                <Button
                  type="button"
                  variant="outline"
                  className="w-full justify-start px-4"
                  onClick={() => handleUpdateStatus(OWNED_LISTING_STATUS_ACTIONS.reopenForReview)}
                  disabled={isUpdatingStatus}
                >
                  {isUpdatingStatus ? t.saving : t.reopenListing}
                </Button>
              ) : null}
              <Button
                type="button"
                variant="destructive"
                className="w-full justify-start px-4"
                onClick={() => {
                  setIsActionSheetOpen(false)
                  setIsDeleteDialogOpen(true)
                }}
              >
                {t.delete}
              </Button>
            </div>
          </SheetContent>
        </Sheet>
      </div>

      <div className="hidden flex-wrap items-center justify-end gap-1.5 whitespace-nowrap md:ml-auto md:flex md:flex-nowrap">
        {canEditListing ? (
          <Button asChild variant="outline" size="xs" className="h-8 rounded-lg bg-white px-2.5 dark:bg-background">
            <Link href={`/listings/${slug}/edit`}>{t.editListing}</Link>
          </Button>
        ) : null}
        {canSubmitForReview ? (
          <Button type="button" variant="outline" size="xs" className="h-8 rounded-lg bg-white px-2.5 dark:bg-background" onClick={() => handleUpdateStatus(OWNED_LISTING_STATUS_ACTIONS.submitForReview)} disabled={isUpdatingStatus}>
            {isUpdatingStatus ? t.saving : status === LISTING_APPROVAL_STATUS_VALUES.rejected ? t.resubmitForReview : t.submitForReview}
          </Button>
        ) : null}
        {canMarkAsSold ? (
          <Button type="button" variant="outline" size="xs" className="h-8 rounded-lg bg-white px-2.5 dark:bg-background" onClick={() => handleUpdateStatus(OWNED_LISTING_STATUS_ACTIONS.markSold)} disabled={isUpdatingStatus}>
            {isUpdatingStatus ? t.saving : t.markAsSold}
          </Button>
        ) : null}
        {canReopenListing ? (
          <Button type="button" variant="outline" size="xs" className="h-8 rounded-lg bg-white px-2.5 dark:bg-background" onClick={() => handleUpdateStatus(OWNED_LISTING_STATUS_ACTIONS.reopenForReview)} disabled={isUpdatingStatus}>
            {isUpdatingStatus ? t.saving : t.reopenListing}
          </Button>
        ) : null}
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
      </div>

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
  )
}
