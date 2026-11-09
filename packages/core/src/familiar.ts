import {
  openWorkspace,
  type Workspace,
  type WorkspaceFamiliar,
  type WorkspaceOptions,
} from './workspace/index.ts'

export type FamiliarOptions = WorkspaceOptions & {
  /**
   * What this Familiar is called: in its default persona, the title of its
   * notifications, and in memory upkeep's prompts. Set on every open.
   * Default `Familiar`.
   */
  name?: string
}

/**
 * A Familiar is one assistant with one owner and one never-ending
 * conversation: a workspace holding just it. A host that serves many owners
 * (households, users) opens one Familiar each.
 */
export type Familiar = Omit<Workspace, 'familiars'> & WorkspaceFamiliar

/**
 * Opens a Familiar over its storage, resuming whatever it was doing, and
 * starts its background work: a workspace with one Familiar, created on
 * first open. One process per storage; `dismiss()` it when done.
 */
export async function summonFamiliar(
  options: FamiliarOptions,
): Promise<Familiar> {
  const { name = 'Familiar', ...workspaceOptions } = options
  const workspace = await openWorkspace(workspaceOptions)
  try {
    const [first] = await workspace.familiars.list()
    if (first && first.name !== name) {
      await workspace.familiars.rename(first.id, name)
    }
    const familiar = first
      ? workspace.familiars.get(first.id)!
      : await workspace.familiars.create({ name })
    // A summoned Familiar is the workspace's only one.
    const { familiars, ...shared } = workspace
    return { ...shared, ...familiar }
  } catch (error) {
    await workspace.dismiss()
    throw error
  }
}
