import { expect, test } from 'vitest'
import { isAllowedHost } from './serve.ts'

test.each([
  '127.0.0.1:4317',
  'localhost:4317',
  '[::1]:4317',
  '192.168.1.20:5174',
  'machine.tail1234.ts.net:10000',
])('accepts %s', (host) => {
  expect(isAllowedHost(host)).toBe(true)
})

// A page that rebinds its own name to this machine arrives with that name.
test.each([
  'evil.example:4317',
  'localhost.evil.example',
  'ts.net.evil.example',
  '',
  null,
])('refuses %s', (host) => {
  expect(isAllowedHost(host)).toBe(false)
})
