import { expect, test } from 'vitest'
import { memorySecrets } from '../connections/index.ts'
import type { FamiliarId } from '../workspace/familiars.ts'
import { familiarSecrets } from './familiar-secrets.ts'

test('removing a Familiar deletes its secrets after every admitted change, and refuses later ones', async () => {
  const store = memorySecrets()
  const plugin = { name: 'p', title: 'P', tools: [], familiarSecrets: ['key'] }
  const secrets = familiarSecrets(store, [plugin])
  const ada = secrets.for(plugin, 1 as FamiliarId)
  const bo = secrets.for(plugin, 2 as FamiliarId)
  await bo.update('key', () => 'bo')

  const admitted = ada.update('key', () => 'before')
  const removed = secrets.remove(1 as FamiliarId)
  await expect(ada.update('key', () => 'after')).rejects.toThrow('removed')
  await Promise.all([admitted, removed])

  expect(await ada.get('key')).toBeUndefined()
  expect(await bo.get('key')).toBe('bo')
  await expect(ada.get('other')).rejects.toThrow('familiarSecrets')
})

test('a removal that fails lets changes in again, and closing waits for admitted ones', async () => {
  const store = memorySecrets()
  const plugin = { name: 'p', title: 'P', tools: [], familiarSecrets: ['key'] }
  const failing = {
    ...store,
    delete: async () => Promise.reject(new Error('disk')),
  }
  const secrets = familiarSecrets(failing, [plugin])
  const ada = secrets.for(plugin, 1 as FamiliarId)

  await expect(secrets.remove(1 as FamiliarId)).rejects.toThrow('disk')
  await ada.update('key', () => 'kept')

  const admitted = ada.update('key', () => 'last')
  await secrets.close()
  expect(await store.get({ kind: 'plugin', name: 'p' }, 'familiar/1/key')).toBe(
    'last',
  )
  await admitted
  await expect(ada.update('key', () => 'late')).rejects.toThrow('closed')
})
