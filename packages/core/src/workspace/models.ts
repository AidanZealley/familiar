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
  type ModelOption,
  type ModelSetting,
} from '../conversation/models.ts'
import {
  familiarDoc,
  Familiars,
  type FamiliarId,
  type FamiliarRecord,
} from './familiars.ts'

/**
 * Which model, at which reasoning level, each Familiar's chat and memory
 * run on. The workspace has a default for each job, and a Familiar's record
 * may choose its own model for either (`chatModel`, `memoryModel`). A
 * default the owner hasn't chosen is the host's.
 *
 * A model's level for a job is the one chosen with it, else the job's
 * default level if it's the default model, else the model's own in
 * `modelChoices`. A chat's level picked in it (`ThinkingLevels`) wins over
 * all of these. A chat's model and level in its `pi.agent` are derived:
 * `applyChatModels` writes them whenever any of this changes, and nothing
 * else writes its model.
 */

/** The model and level for each job, as the workspace defaults them. */
export type ModelDefaults = {
  chat: Required<ModelSetting>
  memory: Required<ModelSetting>
}

/** A change to the defaults: each job given replaces that job's. */
export type ModelDefaultsChange = {
  chat?: ModelSetting
  memory?: ModelSetting
}

/** The defaults the owner chose; a job left out follows the host's. */
export const ChosenDefaults = defineDoc<ModelDefaultsChange>({
  kind: 'familiar.model-defaults',
  version: 1,
  scope: 'session',
  initial: () => ({}),
  checkpointWhen: () => true, // small: always store it whole
})

const same = (a: ModelRef, b: ModelRef) => modelKey(a) === modelKey(b)

const setting = ({ model, thinkingLevel }: ModelChoice) => ({
  ...model,
  thinkingLevel,
})

export function createModelSettings(
  options: readonly ModelOption[],
  host: { chat: ModelRef; memory: ModelRef },
) {
  /**
   * `chosen` as a choice on offer, at its level as the module comment
   * says; undefined if its model isn't offered, or no longer is after a
   * restart, so it falls back like any other choice.
   */
  const resolve = (
    chosen: ModelSetting | undefined,
    fallback?: ModelChoice,
  ): ModelChoice | undefined => {
    const option = findModelChoice(options, chosen)
    if (!option) {
      return undefined
    }
    const level = chosen?.thinkingLevel
    return {
      model: option.model,
      thinkingLevel:
        level && option.thinkingLevels.includes(level)
          ? level
          : fallback && same(fallback.model, option.model)
            ? fallback.thinkingLevel
            : option.thinkingLevel,
    }
  }
  const defaultsOf = (chosen: Readonly<ModelDefaultsChange>) => ({
    chat: resolve(chosen.chat) ?? resolve(host.chat)!,
    memory: resolve(chosen.memory) ?? resolve(host.memory)!,
  })

  /**
   * `chosen`, if its model is on offer and supports its level. Throws a
   * TypeError if not.
   */
  const check = <T extends ModelSetting>(chosen: T) => {
    const option = findModelChoice(options, chosen)
    if (!option) {
      throw new TypeError(`${modelKey(chosen)} must be one of modelChoices.`)
    }
    if (
      chosen.thinkingLevel &&
      !option.thinkingLevels.includes(chosen.thinkingLevel)
    ) {
      throw new TypeError(
        `${option.name} has no ${chosen.thinkingLevel} reasoning.`,
      )
    }
    return chosen
  }

  /**
   * Puts each Familiar's chat on the model and level it resolves to now,
   * unless it's already on them. Reads everything before its first write,
   * as a transaction must.
   */
  const applyChatModels = async (tx: Tx, familiars: FamiliarId[]) => {
    const defaults = defaultsOf(await tx.doc(ChosenDefaults))
    const registry = await tx.doc(Familiars)
    const changes = []
    for (const familiar of familiars) {
      const agent = await tx.doc(AgentDoc, familiar)
      const levels = await familiarDoc(tx, ThinkingLevels, familiar)
      const record = registry.familiars[familiar]!
      const { model, thinkingLevel } =
        resolve(record.chatModel, defaults.chat) ?? defaults.chat
      const level = levels[modelKey(model)] ?? thinkingLevel
      if (
        !agent.model ||
        !same(agent.model, model) ||
        agent.thinkingLevel !== level
      ) {
        changes.push({ familiar, model, thinkingLevel: level })
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
    defaults: (
      chosen: Readonly<ModelDefaultsChange> | undefined,
    ): ModelDefaults => {
      const { chat, memory } = defaultsOf(chosen ?? {})
      return { chat: setting(chat), memory: setting(memory) }
    },
    /** What `record`'s memory runs on: its own choice, else the default. */
    memoryOf: async (tx: Tx, record: FamiliarRecord) => {
      const defaults = defaultsOf(await tx.doc(ChosenDefaults))
      return resolve(record.memoryModel, defaults.memory) ?? defaults.memory
    },
    /**
     * Changes the defaults, and moves every Familiar's chat that follows
     * them. Throws a TypeError for a model that isn't a choice or a level
     * it doesn't support.
     */
    setDefaults: async (tx: Tx, change: ModelDefaultsChange) => {
      const chosen = await tx.doc(ChosenDefaults)
      for (const job of ['chat', 'memory'] as const) {
        const value = change[job]
        if (value) {
          chosen[job] = check(value)
        }
      }
      const registry = await tx.doc(Familiars)
      await applyChatModels(
        tx,
        Object.keys(registry.familiars).map((id) => Number(id) as FamiliarId),
      )
    },
  }
}
