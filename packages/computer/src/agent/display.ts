import { spawn, type ChildProcess } from 'node:child_process'
import { once } from 'node:events'
import { rm } from 'node:fs/promises'
import { SCREEN } from '../tools.ts'
import { DISPLAY_SOCKET } from './socket.ts'

const DISPLAY = ':1'

/**
 * Starts the computer's display: TigerVNC's Xvnc, an X server that serves
 * itself over VNC on `DISPLAY_SOCKET` only, then the JWM window manager.
 * Once the display takes X clients it sets `DISPLAY` for every process the
 * agent starts after: the browser, commands and the screen tools.
 *
 * The display is always `SCREEN`'s size: viewers can't resize it. The
 * clipboard never crosses to or from a viewer. If Xvnc or JWM ends, it
 * calls `lost`, as the computer can't work without them.
 */
export async function startDisplay(lost: (reason: string) => void) {
  // Left by a display that was running when the computer last stopped. Its
  // process IDs can be taken again, so the X server can't tell they're stale.
  await Promise.all(
    [
      `/tmp/.X${DISPLAY.slice(1)}-lock`,
      `/tmp/.X11-unix/X${DISPLAY.slice(1)}`,
      DISPLAY_SOCKET,
    ].map((path) => rm(path, { force: true })),
  )
  const xvnc = spawn(
    'Xvnc',
    [
      DISPLAY,
      '-geometry',
      `${SCREEN.width}x${SCREEN.height}`,
      '-depth',
      '24',
      // VNC on the Unix socket only, for the person's own `docker exec`.
      '-rfbport',
      '-1',
      '-rfbunixpath',
      DISPLAY_SOCKET,
      '-SecurityTypes',
      'None',
      '-nolisten',
      'tcp',
      // Every viewer shares the one screen.
      '-AlwaysShared',
      // A fixed size: no viewer or app can change it. Besides, TigerVNC 1.12
      // crashes on some viewers' resize requests.
      '-AcceptSetDesktopSize=0',
      '-extension',
      'RANDR',
      // Nothing on the desktop, such as vncconfig, may change these.
      '-AllowOverride',
      '',
      '-AcceptCutText=0',
      '-SendCutText=0',
      '-SetPrimary=0',
      '-SendPrimary=0',
      '-Log',
      '*:stderr:0',
      // Writes the display's number here once it takes X clients.
      '-displayfd',
      '3',
    ],
    { stdio: ['ignore', 'ignore', 'inherit', 'pipe'] },
  )
  await ready(xvnc)
  process.env.DISPLAY = DISPLAY
  watch(xvnc, 'The display', lost)
  watch(
    spawn('jwm', [], { stdio: ['ignore', 'ignore', 'inherit'] }),
    'The window manager',
    lost,
  )
}

/** Settles once Xvnc writes its display number, or fails if it ends first. */
async function ready(xvnc: ChildProcess) {
  const started = once(xvnc.stdio[3]!, 'data')
  const ended = once(xvnc, 'exit').then(([code]) => {
    throw new Error(`The display couldn't start (exit code ${code}).`)
  })
  await Promise.race([started, ended])
}

const watch = (
  child: ChildProcess,
  name: string,
  lost: (reason: string) => void,
) => {
  child.on('error', (error) => lost(`${name} couldn't run: ${error.message}`))
  child.on('exit', (code, signal) =>
    lost(`${name} ended (${signal ?? `exit code ${code}`}).`),
  )
}
