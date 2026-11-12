import {
  openWorkspace,
  type FamiliarId,
  type WorkspaceOptions,
} from '@familiar-ai/core'

/**
 * Opens the daemon's workspace with its first Familiar named `name`, as the
 * config says on every open. A fresh store gets that Familiar now.
 */
export async function openDaemonWorkspace(
  options: WorkspaceOptions,
  name: string,
) {
  const workspace = await openWorkspace(options)
  try {
    const [first] = await workspace.familiars.list()
    let familiar: FamiliarId
    if (!first) {
      familiar = (await workspace.familiars.create({ name })).id
    } else {
      familiar = first.id
      if (first.name !== name) {
        await workspace.familiars.update(familiar, { name })
      }
    }
    return { workspace, familiar }
  } catch (error) {
    await workspace.dismiss()
    throw error
  }
}
