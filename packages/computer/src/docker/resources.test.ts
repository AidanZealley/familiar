import { expect, test } from 'vitest'
import { imageRepository } from './resources.ts'

// Old images are removed from this repository only, so it must be the image's own.
test("an image's repository and tag, whatever form its reference takes", () => {
  expect(
    imageRepository('ghcr.io/aidanzealley/familiar-computer:1.2.0'),
  ).toEqual({
    repository: 'ghcr.io/aidanzealley/familiar-computer',
    tag: '1.2.0',
  })
  expect(imageRepository('acme/computer')).toEqual({
    repository: 'acme/computer',
    tag: 'latest',
  })
  expect(imageRepository('localhost:5000/acme/computer')).toEqual({
    repository: 'localhost:5000/acme/computer',
    tag: 'latest',
  })
  expect(imageRepository('localhost:5000/acme/computer:dev')).toEqual({
    repository: 'localhost:5000/acme/computer',
    tag: 'dev',
  })
  expect(imageRepository('acme/computer@sha256:abc')).toBeUndefined()
})
