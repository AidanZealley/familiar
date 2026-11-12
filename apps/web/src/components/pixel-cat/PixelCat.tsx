import { cn } from 'cn'
import type { PixelCatProps } from './types'

/**
 * Familiar's cat, in the text colour. Its art and animation live in
 * `public/loading.css`, which the page loads before the app, so the
 * loader in `index.html` shows the same cat. Size it in whole multiples
 * of 16px so its pixels stay whole.
 */
export const PixelCat = ({ animated = false, className }: PixelCatProps) => (
  <span
    aria-hidden
    data-animated={animated || undefined}
    className={cn('pixel-cat', className)}
  />
)
