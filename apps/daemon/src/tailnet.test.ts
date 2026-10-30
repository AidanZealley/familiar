import { execFileSync } from 'node:child_process'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { publish, publishedUrl, unpublish } from './tailnet.ts'

vi.mock('node:child_process', () => ({ execFileSync: vi.fn() }))
const host = 'machine.example.ts.net:10000'
let publication: Record<string, unknown>
const calls = () =>
  vi.mocked(execFileSync).mock.calls.map(([, args]) => args?.join(' '))
const existing = (proxy = 'http://127.0.0.1:4317') => ({
  TCP: { '10000': { HTTPS: true } },
  Web: { [host]: { Handlers: { '/': { Proxy: proxy } } } },
})
beforeEach(() => {
  publication = {}
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.mocked(execFileSync)
    .mockReset()
    .mockImplementation((_command, args) => {
      if (args?.[0] === 'status') {
        return JSON.stringify({
          BackendState: 'Running',
          Self: { DNSName: 'machine.example.ts.net.' },
        }) as never
      }
      if (args?.[1] === 'status') {
        return JSON.stringify(publication) as never
      }
      return '' as never
    })
})
afterEach(() => {
  vi.restoreAllMocks()
})

test('publishes loopback through tailnet HTTPS and returns the actual DNS name', () => {
  expect(publish(4320)).toBe(`https://${host}`)
  expect(calls()).toContain(
    'serve --bg --https=10000 --yes http://127.0.0.1:4320',
  )
})

test('an existing matching publication is left alone', () => {
  publication = existing()
  expect(publish(4317)).toBe(`https://${host}`)
  expect(calls()).toEqual(['status --json', 'serve status --json'])
})

test.each([
  existing('http://127.0.0.1:9999'),
  { TCP: { '10000': { TCPForward: '127.0.0.1:9999' } } },
  { ...existing(), AllowFunnel: { [host]: true } },
])(
  'conflicting routes and public Funnel access are never overwritten',
  (config) => {
    publication = config
    expect(publish(4317)).toBeUndefined()
    expect(calls()).toEqual(['status --json', 'serve status --json'])
  },
)

test('missing Tailscale gives installation guidance without breaking local setup', () => {
  vi.mocked(execFileSync).mockImplementation(() => {
    throw Object.assign(new Error('missing'), { code: 'ENOENT' })
  })
  expect(publish(4317)).toBeUndefined()
  expect(console.log).toHaveBeenCalledWith(
    expect.stringContaining('Install Tailscale'),
  )
})

test('permissions produce the operator command and leave local setup usable', () => {
  vi.mocked(execFileSync).mockImplementation(() => {
    throw new Error('access denied')
  })
  expect(publish(4317)).toBeUndefined()
  expect(console.log).toHaveBeenCalledWith(
    expect.stringContaining('sudo tailscale set --operator='),
  )
})

test('removal targets only the matching publication, never resets all Serve routes', () => {
  publication = existing()
  unpublish(4317)
  expect(calls()).toContain('serve --https=10000 off')
  publication = existing('http://127.0.0.1:9999')
  vi.mocked(execFileSync).mockClear()
  unpublish(4317)
  expect(calls()).toEqual(['serve status --json'])
})

test('removal preserves other routes sharing the HTTPS port', () => {
  publication = {
    Web: {
      [host]: {
        Handlers: {
          '/': { Proxy: 'http://127.0.0.1:4317' },
          '/other': { Proxy: 'http://127.0.0.1:9999' },
        },
      },
    },
  }
  unpublish(4317)
  expect(calls()).toEqual(['serve status --json'])
})

test('reading an existing URL never publishes a new route', () => {
  publication = existing()
  expect(publishedUrl(4317)).toBe(`https://${host}`)
  expect(calls()).toEqual(['serve status --json'])
  publication = {}
  expect(publishedUrl(4317)).toBeUndefined()
})

test('status never reports a public Funnel route as a private tailnet URL', () => {
  publication = { ...existing(), AllowFunnel: { [host]: true } }
  expect(publishedUrl(4317)).toBeUndefined()
})
