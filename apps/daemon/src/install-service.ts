// Run Familiar as a systemd user service: started at boot, restarted if it
// crashes. Serves the API and the built web UI. Usage: pnpm service:install

import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '../../..')
const unitDir = resolve(homedir(), '.config/systemd/user')
const unitPath = resolve(unitDir, 'familiar.service')

mkdirSync(unitDir, { recursive: true })
writeFileSync(
  unitPath,
  `[Unit]
Description=Familiar, a personal assistant
After=network-online.target

[Service]
WorkingDirectory=${root}
ExecStart=${process.execPath} apps/daemon/src/main.ts
Restart=on-failure
RestartSec=5

[Install]
WantedBy=default.target
`,
)

const systemctl = (...args: string[]) =>
  execFileSync('systemctl', ['--user', ...args], { stdio: 'inherit' })

systemctl('daemon-reload')
systemctl('enable', '--now', 'familiar')
systemctl('restart', 'familiar') // pick up a new build when already running

console.log(`Installed ${unitPath}. Logs: pnpm service:logs`)
