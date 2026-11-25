// The image processor for a Worker's `images`: Pi's Photon, its
// WebAssembly imported as a Workers module. Its own entry, so a Worker that
// takes no images doesn't bundle it.
export { createCloudflarePhotonImages } from '@earendil-works/pi-durable/images/cloudflare'
