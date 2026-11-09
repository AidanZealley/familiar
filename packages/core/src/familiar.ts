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
  /**
   * Who this Familiar is in conversation, in place of `defaultPersona(name)`,
   * used exactly as given, so include the name if the model should know it.
   * Set on every open. Core still adds what its own features need.
   */
  persona?: string
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
  const { name = 'Familiar', persona, ...workspaceOptions } = options
  const workspace = await openWorkspace(workspaceOptions)
  try {
    // The host's options say who it is, so they're applied on every open.
    const [first] = await workspace.familiars.list()
    if (first && (first.name !== name || first.persona !== persona)) {
      await workspace.familiars.update(first.id, {
        name,
        persona: persona ?? null,
      })
    }
    const familiar = first
      ? workspace.familiars.get(first.id)!
      : await workspace.familiars.create({
          name,
          ...(persona !== undefined && { persona }),
        })
    // A summoned Familiar is the workspace's only one.
    const { familiars, ...shared } = workspace
    return { ...shared, ...familiar }
  } catch (error) {
    await workspace.dismiss()
    throw error
  }
}
