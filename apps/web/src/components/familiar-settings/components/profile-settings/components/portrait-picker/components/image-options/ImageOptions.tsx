import { ImagesHelp } from '../images-help'
import { PortraitOption } from '../portrait-option'
import type { ImageOptionsProps } from './types'

/** The owner's images to choose from, then where to add more. */
export const ImageOptions = ({
  familiar,
  images,
  value,
  onChange,
}: ImageOptionsProps) => (
  <div className="flex flex-col gap-3">
    {images.names.length > 0 && (
      <div role="group" aria-label="Images" className="flex flex-wrap gap-1">
        {images.names.map((name) => (
          <PortraitOption
            key={name}
            familiar={familiar}
            avatar={name}
            selected={value === name}
            onSelect={() => onChange(name)}
            name={name}
          />
        ))}
      </div>
    )}
    <ImagesHelp folder={images.folder} />
  </div>
)
