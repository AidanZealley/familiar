import { docker, reasonOf } from './resources.ts'

const RETRY_MS = 60_000

/** Whether the computers' image is here to make computers from, and if not, why. */
export type ImageState =
  | { state: 'setting-up' }
  | { state: 'ready' }
  | { state: 'unavailable'; reason: string }

/**
 * The computers' image, `repository:tag`, on this machine: fetched in the
 * background from the start, unless it's here already, and again each
 * minute while that fails, such as before Docker is installed. Once it's
 * here, its other versions that no container uses are removed, so the
 * machine keeps one.
 */
export function computerImage(repository: string, tag: string) {
  const image = `${repository}:${tag}`
  let state: ImageState = { state: 'setting-up' }
  let resolve!: () => void
  const ready = new Promise<void>((done) => (resolve = done))

  /**
   * Removes the other tags of `repository`, such as earlier releases'
   * images, each unless a container uses it, whichever host's: those stay
   * until a later try. Docker alone would refuse only an image's last
   * tag, so it's checked here.
   */
  const removeOld = async () => {
    const tags = await docker(
      'image',
      'ls',
      '--format',
      '{{.Repository}}:{{.Tag}}',
      repository,
    ).catch(() => '')
    for (const tag of tags.split('\n')) {
      if (
        tag &&
        tag !== image &&
        !tag.endsWith(':<none>') &&
        !(await docker(
          'container',
          'ls',
          '--all',
          '--quiet',
          '--filter',
          `ancestor=${tag}`,
        ).catch(() => 'unknown'))
      ) {
        await docker('image', 'rm', tag).catch(() => {})
      }
    }
  }

  const fetch = () => {
    state = { state: 'setting-up' }
    docker('image', 'inspect', image)
      .catch(() => docker('pull', image))
      .then(
        () => {
          state = { state: 'ready' }
          resolve()
          void removeOld()
        },
        (error) => {
          state = { state: 'unavailable', reason: reasonOf(error) }
          setTimeout(fetch, RETRY_MS).unref()
        },
      )
  }
  fetch()

  return {
    get state() {
      return state
    },
    /** Settles once the image is here, however many tries that takes. */
    ready,
    /** Removes the image's other versions no container uses; never fails. */
    removeOld,
  }
}
