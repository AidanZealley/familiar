import type { FamiliarId } from '@familiar-ai/core'
import type { CallToolResult } from '@modelcontextprotocol/client'

/**
 * Where Familiars' computers run, such as `dockerHost()`. It owns
 * everything that runs: whether each computer exists, is running or asleep,
 * and when it sleeps. The plugin only tells it who should have one.
 */
export type ComputerHost = {
  /**
   * Runs a computer tool on the Familiar's computer, making or waking it
   * first. A result that couldn't run says why (no Docker, say), and one that
   * woke the computer says so. Throws if the computer stopped answering
   * during the call, or when `signal` stops it.
   */
  call(
    familiar: FamiliarId,
    tool: string,
    args: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<CallToolResult>
  /**
   * The Familiars that should have computers: makes any missing, and removes
   * any other's, disk included. Idempotent; calls run one at a time.
   */
  sync(familiars: readonly FamiliarId[]): Promise<void>
  status(familiar: FamiliarId): Promise<ComputerStatus>
}

/**
 * A Familiar's computer: running, asleep (stopped; Docker keeps its disk,
 * Cloudflare doesn't), being set up (its image downloading), none, or
 * unavailable on this host and why, such as Docker not being installed or
 * the host having as many computers as it allows.
 */
export type ComputerStatus =
  | { state: 'running' | 'asleep' | 'setting-up' | 'none' }
  | { state: 'unavailable'; reason: string }
