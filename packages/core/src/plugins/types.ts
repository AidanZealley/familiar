import type { Hono, Schema } from 'hono'
import type { PluginSecret } from '../connections/index.ts'
import type { Author } from '../conversation/message.ts'
import type { FamiliarTool } from '../tools.ts'
import type { FamiliarId } from '../workspace/familiars.ts'

export type { FamiliarTool } from '../tools.ts'

/**
 * Tools that aren't core's, grouped under a stable name with the secrets they
 * share. Each tool is a plain Pi tool; Familiar gives it `familiar(context)`.
 */
export type FamiliarPlugin = {
  /** Keys its secrets and its routes' path, so keep it stable. */
  name: string
  /** For the owner, on the Connections page. */
  title: string
  secrets?: readonly PluginSecret[]
  tools: readonly FamiliarTool[]
  /**
   * Called once the workspace is open, before it resumes the work the last
   * process left unfinished, so no resumed tool call reaches the plugin
   * before it knows the workspace: opening waits for it, and for the first
   * telling of each `watchFamiliars` it begins. Start slow work without
   * awaiting it. Returns what to call when the workspace closes, by
   * `dismiss()` or a storage failure.
   */
  open?(context: PluginContext): PluginClose | Promise<PluginClose>
  /**
   * Routes about one Familiar, which `createHttpApi` mounts at
   * `/plugins/<name>/familiars/:familiar`, behind the host's `authenticate`
   * and `allow`, asked for `plugins.<name>` with that Familiar's ID. A
   * Familiar that doesn't exist is 404 before they run.
   */
  routes?: Hono<PluginEnv, Schema, string>
}

/** What `open` returns: nothing, or what to call when the workspace closes. */
export type PluginClose = void | (() => void | Promise<void>)

/** What a plugin is given when its workspace opens. */
export type PluginContext = {
  /**
   * Calls `listener` with the Familiars that use this plugin, those that
   * have it turned on, then again when that changes: one turns it on or
   * off, or is created with it or removed. Called from `open`, the first
   * call comes before `open`'s workspace resumes any work; later ones come
   * asynchronously. If storage can't be read, as when it fails, there is no
   * call until it can, and opening goes on without one. Changes close
   * together may come as one; the last call is always who uses it now. In
   * order, until the workspace closes. A promise it returns isn't awaited,
   * so it handles its own errors.
   */
  watchFamiliars(listener: (familiars: FamiliarId[]) => void): void
}

/** What a plugin's routes are given: who is asking, and the Familiar in the path. */
export type PluginEnv = { Variables: { author: Author; familiar: FamiliarId } }
