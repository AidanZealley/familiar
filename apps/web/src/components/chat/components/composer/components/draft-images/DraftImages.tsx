import { AttachedImage } from './components/attached-image'
import type { DraftImagesProps } from './types'

/** A draft's images, in a strip above its text, each with a × if removable. */
export const DraftImages = ({ images, onRemove }: DraftImagesProps) => (
  <ul
    aria-label="Attached images"
    className="flex w-full [scrollbar-width:none] gap-2.5 overflow-x-auto px-3 pt-3 pb-1"
  >
    {images.map((image, index) => (
      <AttachedImage
        key={image.id}
        image={image}
        index={index}
        onRemove={onRemove && (() => onRemove(image.id))}
      />
    ))}
  </ul>
)
