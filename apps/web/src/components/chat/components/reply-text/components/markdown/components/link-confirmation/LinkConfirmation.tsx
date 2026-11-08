import { CopyIcon, ExternalLinkIcon } from 'lucide-react'
import { toast } from 'sonner'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import type { LinkConfirmationProps } from './types'

export const LinkConfirmation = ({
  url,
  isOpen,
  onClose,
  onConfirm,
}: LinkConfirmationProps) => {
  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(url)
      toast.success('Link copied')
    } catch {
      toast.error("Couldn't copy link")
    }
  }

  return (
    <AlertDialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Open external link?</AlertDialogTitle>
          <AlertDialogDescription>
            You're about to visit an external website.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="min-w-0 bg-muted p-3 text-xs leading-relaxed wrap-anywhere select-text">
          {url}
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <Button variant="outline" onClick={copyLink}>
            <CopyIcon />
            Copy link
          </Button>
          <AlertDialogAction onClick={onConfirm}>
            <ExternalLinkIcon />
            Open link
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
