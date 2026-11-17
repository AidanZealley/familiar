import { expect, test } from 'vitest'
import { isPublic } from './proxy.ts'

// The proxy's one rule, which CI checks without Docker.
test('only public internet addresses are public', () => {
  const notPublic = [
    '127.0.0.1',
    '10.1.2.3',
    '172.17.0.1',
    '192.168.13.211',
    '100.97.253.21', // a tailnet
    '169.254.169.254', // cloud metadata
    '0.0.0.0',
    '::1',
    'fd7a:115c:a1e0::1',
    'fe80::1',
    '::ffff:192.168.1.1',
    'localhost',
  ]
  expect(notPublic.filter(isPublic)).toEqual([])
  expect(['93.184.215.14', '2606:4700::1111'].every(isPublic)).toBe(true)
})
