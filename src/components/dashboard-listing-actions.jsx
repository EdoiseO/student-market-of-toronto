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

export function DashboardListingActions({ id, slug, status }) {
  const router = useRouter()
  const supabase = createClient()
  const [isUpdatingStatus, setIsUpdatingStatus] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false)
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

    const { error } = await supabase
      .from("listings")
      .update({ status: nextStatus })
      .eq("id", id)
      .eq("seller_id", user.id)

    setIsUpdatingStatus(false)

    if (error) {
      console.error("Failed to update listing status:", error.message)
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
    <div className="flex justify-end gap-2">
      <Button
        asChild
        variant="outline"
        size="sm"
        className="h-9 rounded-xl bg-white px-4"
      >
        <Link href={`/listings/${slug}/edit`}>Edit</Link>
      </Button>
      {canMarkAsSold ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-9 rounded-xl bg-white px-4"
          onClick={() => handleUpdateStatus("sold")}
          disabled={isUpdatingStatus}
        >
          {isUpdatingStatus ? "Saving..." : "Mark as Sold"}
        </Button>
      ) : null}
      {canReopenListing ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-9 rounded-xl bg-white px-4"
          onClick={() => handleUpdateStatus("active")}
          disabled={isUpdatingStatus}
        >
          {isUpdatingStatus ? "Saving..." : "Reopen Listing"}
        </Button>
      ) : null}
      <AlertDialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
        <AlertDialogTrigger asChild>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-9 rounded-xl border-rose-200 bg-rose-50 px-4 text-rose-700 hover:bg-rose-100"
          >
            Delete
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this listing?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently remove the listing and its uploaded images.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} disabled={isDeleting}>
              {isDeleting ? "Deleting..." : "Delete Listing"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
