import { PixelCat } from '@/components/pixel-cat'

/** The hopping cat, as `index.html` shows before the app loads. */
export const AppLoader = () => (
  <div className="app-loader" role="status" aria-label="Loading Familiar">
    <PixelCat animated />
  </div>
)
