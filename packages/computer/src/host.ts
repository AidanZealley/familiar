import type { FamiliarId } from '@familiar-ai/core'
import type { CallToolResult } from '@modelcontextprotocol/client'

/**
 * Where Familiars' computers run, such as `dockerHost()`. It owns
 * everything that runs: whether each computer exists, is running or asleep,
 * and when it sleeps. The plugin only tells it who should have one. A host
 * belongs to one `computer` plugin in one workspace, which closes it when
 * the workspace closes.
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
   * any other's, disk included. Idempotent; when calls overlap, the latest
   * list wins.
   */
  sync(familiars: readonly FamiliarId[]): Promise<void>
  /**
   * The Familiar's screen as it is now, for a person watching: the display's
   * VNC (RFB) bytes both ways, which a viewer such as noVNC speaks, or
   * undefined if the computer isn't running. Never wakes the computer or
   * keeps it awake. Ends when the computer stops, the host closes or
   * `signal` aborts; each call is its own stream.
   */
  screen(
    familiar: FamiliarId,
    signal: AbortSignal,
  ): Promise<ByteStream | undefined>
  /** Cheap enough to poll. */
  status(familiar: FamiliarId): Promise<ComputerStatus>
  /**
   * The Familiar's computer in detail, read now, for a person looking at
   * it. A host fills in what it can tell; it never wakes a sleeping one.
   */
  inspect(familiar: FamiliarId): Promise<ComputerDetail>
  /** Every computer on this host, for an overview. */
  summary(): Promise<ComputersSummary>
  /**
   * Stops its background work and closes its connections to computers.
   * Never removes a computer or its disk: they're there when a host opens
   * again. Safe to call twice; make no more calls after it.
   */
  close(): Promise<void>
}

/**
 * A Familiar's computer: running, asleep (stopped, its disk kept), being set
 * up (its image downloading), none, or unavailable on this host and why,
 * such as Docker not being installed or the host having as many computers
 * as it allows.
 */
export type ComputerStatus =
  | { state: 'running' | 'asleep' | 'setting-up' | 'none' }
  | { state: 'unavailable'; reason: string }

/** Bytes both ways, such as a computer's screen. */
export type ByteStream = {
  readable: ReadableStream<Uint8Array<ArrayBuffer>>
  writable: WritableStream<Uint8Array<ArrayBuffer>>
}

/** Some amount in use against its limit, such as memory in bytes. */
export type Usage = { used: number; limit?: number }

/** A call running on a computer: its tool and a short target, such as the URL or command. */
export type ComputerCall = { tool: string; target?: string }

/**
 * A Familiar's computer in detail. Every field is optional: each host fills
 * in what it can tell, and the rest is left out rather than guessed.
 * Times are ISO 8601.
 */
export type ComputerDetail = {
  status?: ComputerStatus
  /** The calls running on it now, oldest first. */
  doing?: ComputerCall[]
  /** When it last started, or while asleep, when it went to sleep. */
  since?: string
  /** When its last call ended, if none is running. */
  lastUsed?: string
  /** CPUs, such as 0.25 of 2. */
  cpu?: Usage
  /** Bytes. */
  memory?: Usage
  /** Processes and threads. */
  processes?: Usage
  /** Bytes its disk (its home) holds. */
  disk?: Usage
  /** The programs running, the most memory (bytes) first. */
  programs?: { command: string; memory?: number }[]
  /** The browser's open tabs. */
  tabs?: { title: string; url: string }[]
  system?: { os?: string; architecture?: string }
}

/** One Familiar's computer in a host's overview. */
export type ComputerSummary = Pick<
  ComputerDetail,
  'doing' | 'since' | 'lastUsed'
> & { familiar: FamiliarId; state: 'running' | 'asleep' }

/** A host's computers: how many it allows, and each one it has. */
export type ComputersSummary = { max?: number; computers: ComputerSummary[] }
