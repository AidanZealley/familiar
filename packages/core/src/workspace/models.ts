import {
  AgentDoc,
  configure,
  defineDoc,
  type ModelRef,
  type Tx,
} from '@earendil-works/pi-durable'
import {
  findModelChoice,
  modelKey,
  ThinkingLevels,
  type ModelChoice,
} from '../conversation/models.ts'
import {
  familiarDoc,
  Familiars,
  type FamiliarId,
  type FamiliarRecord,
} from './familiars.ts'

/**
 * Which model each Familiar's chat and memory run on. The workspace has a
 * default for each, and a Familiar's record may override either
 * (`chatModel`, `memoryModel`). A default the owner hasn't chosen is the
 * host's. A chat's model in its `pi.agent` is derived from these:
 * `applyChatModels` writes it whenever they change, and nothing else does.
 */

/** A model for each job, as the workspace defaults or a Familiar runs them. */
export type ModelDefaults = { chat: ModelRef; memory: ModelRef }

/** A change to the workspace's defaults: each model given replaces that job's. */
export type ModelDefaultsChange = Partial<ModelDefaults>

/** The defaults the owner chose; a job left out follows the host's. */
export const ChosenDefaults = defineDoc<Partial<ModelDefaults>>({
  kind: 'familiar.model-defaults',
  version: 1,
  scope: 'session',
  initial: () => ({}),
  checkpointWhen: () => true, // small: always store it whole
})

export function createModelSettings(
  modelChoices: readonly ModelChoice[],
  host: ModelDefaults,
) {
  const find = (model: ModelRef | undefined) =>
    findModelChoice(modelChoices, model)
  // A choice a later restart no longer offers falls back, like an override.
  const defaultsOf = (chosen: Readonly<Partial<ModelDefaults>>) => ({
    chat: find(chosen.chat) ?? find(host.chat)!,
    memory: find(chosen.memory) ?? find(host.memory)!,
  })
  const chatOf = (
    chosen: Readonly<Partial<ModelDefaults>>,
    record: FamiliarRecord,
  ) => find(record.chatModel) ?? defaultsOf(chosen).chat

  /** `model`, if it's one of `modelChoices`. Throws a TypeError if not. */
  const check = (model: ModelRef) => {
    if (!find(model)) {
      throw new TypeError(`${modelKey(model)} must be one of modelChoices.`)
    }
    return model
  }

  /**
   * Puts each Familiar's chat on the model it resolves to now: on the level
   * last picked for it, else its default, unless it's already on it.
   * Reads everything before its first write, as a transaction must.
   */
  const applyChatModels = async (tx: Tx, familiars: FamiliarId[]) => {
    const chosen = await tx.doc(ChosenDefaults)
    const registry = await tx.doc(Familiars)
    const changes = []
    for (const familiar of familiars) {
      const agent = await tx.doc(AgentDoc, familiar)
      const levels = await familiarDoc(tx, ThinkingLevels, familiar)
      const choice = chatOf(chosen, registry.familiars[familiar]!)
      if (
        !agent.model ||
        !agent.thinkingLevel ||
        modelKey(agent.model) !== modelKey(choice.model)
      ) {
        changes.push({
          familiar,
          model: choice.model,
          thinkingLevel: levels[modelKey(choice.model)] ?? choice.thinkingLevel,
        })
      }
    }
    for (const { familiar, ...change } of changes) {
      await configure(tx, familiar, change)
    }
  }

  return {
    check,
    applyChatModels,
    /** The workspace's defaults, from its committed state. */
    defaults: (chosen: Readonly<Partial<ModelDefaults>> | undefined) => {
      const { chat, memory } = defaultsOf(chosen ?? {})
      return { chat: chat.model, memory: memory.model }
    },
    /** What `record`'s memory runs on: its own choice, else the default. */
    memoryOf: async (tx: Tx, record: FamiliarRecord) =>
      find(record.memoryModel) ??
      defaultsOf(await tx.doc(ChosenDefaults)).memory,
    /**
     * Changes the defaults, and moves every Familiar's chat that follows the
     * chat default. Throws a TypeError for a model that isn't a choice.
     */
    setDefaults: async (tx: Tx, change: ModelDefaultsChange) => {
      const chosen = await tx.doc(ChosenDefaults)
      if (change.chat) {
        chosen.chat = check(change.chat)
      }
      if (change.memory) {
        chosen.memory = check(change.memory)
      }
      const registry = await tx.doc(Familiars)
      await applyChatModels(
        tx,
        Object.keys(registry.familiars).map((id) => Number(id) as FamiliarId),
      )
    },
  }
}

export type ModelSettings = ReturnType<typeof createModelSettings>
