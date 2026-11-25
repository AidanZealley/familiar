import type { ImageRef, RoomState } from '@familiar-ai/client'
import { describe, expect, it, vi } from 'vitest'
import {
  isShown,
  outbox,
  retry,
  send,
  upload,
  type Room,
  type Send,
} from './outbox'

const room = 1
// GIFs upload as they are, so nothing here needs a canvas.
const gif = (name: string) => new File([name], name, { type: 'image/gif' })
const refOf = (file: Blob): ImageRef => ({
  id: (file as File).name,
  mimeType: 'image/gif',
  width: 1,
  height: 1,
})
const sendsIn = (room: number) => outbox.getState().sends.get(room) ?? []

describe('outbox', () => {
  it('retries a send whose upload failed once, with its request ID, uploading only what failed', async () => {
    let failures = 2
    const uploadImage = vi.fn(async (file: Blob) => {
      if ((file as File).name === 'b' && failures-- > 0) {
        throw new Error('Network error')
      }
      return refOf(file)
    })
    const to = {
      uploadImage,
      send: vi.fn(async () => ({ entry: 7 })),
      note: vi.fn(),
      getState: () => ({ view: undefined }) as unknown as RoomState,
    } as unknown as Room
    const a = { id: 101, file: gif('a') }
    const b = { id: 102, file: gif('b') }
    // Attached: `a` uploads, `b` fails.
    await Promise.all(
      [a, b].map(({ id, file }) => upload(id, file, uploadImage)),
    )

    send(
      room,
      { text: 'Look', picked: [], images: [a, b], note: false },
      { text: 'Look' },
      to,
    )
    // Send tries `b` again once, which fails too.
    await vi.waitFor(() =>
      expect(sendsIn(room)[0]?.phase.status).toBe('failed'),
    )
    const [failed] = sendsIn(room)
    retry(room, failed!.key, to)
    await vi.waitFor(() =>
      expect(sendsIn(room)[0]?.phase).toEqual({ status: 'posted', entry: 7 }),
    )

    expect(uploadImage.mock.calls.map(([file]) => (file as File).name)).toEqual(
      ['a', 'b', 'b', 'b'],
    )
    expect(to.send).toHaveBeenCalledOnce()
    expect(to.send).toHaveBeenCalledWith('Look', {
      mentions: undefined,
      images: ['a', 'b'],
      requestId: failed!.requestId,
    })
  })

  it('shows a send until the room shows its entry, found by request ID or entry', () => {
    const at = (phase: Send['phase']) => ({ requestId: 'r1', phase }) as Send
    const view = (entries: { id: number; data?: object }[]) =>
      ({ entries }) as unknown as RoomState['view']
    const posted = at({ status: 'posted', entry: 5 })

    expect(isShown(posted, undefined)).toBe(false)
    expect(isShown(posted, view([{ id: 4 }]))).toBe(false)
    expect(isShown(posted, view([{ id: 5 }]))).toBe(true)
    // The stream can deliver it before the post answers.
    const posting = at({ status: 'posting' })
    expect(isShown(posting, view([{ id: 6 }]))).toBe(false)
    expect(isShown(posting, view([{ id: 6, data: { requestId: 'r1' } }]))).toBe(
      true,
    )
  })
})
