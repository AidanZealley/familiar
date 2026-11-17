/** Throws the daemon's `{ error }` message, or the status, for a failed response. */
export async function check(response: Response) {
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as {
      error?: string
    }
    throw new Error(body.error ?? response.statusText)
  }
}
