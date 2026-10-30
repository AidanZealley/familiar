#!/usr/bin/env node
import { parseArgs } from 'node:util'

const help = `Usage: familiar [command]

Run familiar without a command for guided setup.

Commands:
  status    Show the name, service status and URLs
  rename    Change Familiar's name, optionally passing the new name
  serve     Run Familiar in the foreground
  sign-in   Sign in with ChatGPT
  update    Update the installed app and restart its service
  logs      Follow service logs
  uninstall Remove the service, keeping your data

Options:
  -h, --help  Show this help
`

try {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: { help: { type: 'boolean', short: 'h' } },
  })
  if (values.help) {
    console.log(help)
  } else if (positionals.length === 0) {
    await (await import('./cli/setup.ts')).setup()
  } else if (positionals.length > (positionals[0] === 'rename' ? 2 : 1)) {
    throw new Error(
      'Only rename accepts an optional name. Run familiar --help for usage.',
    )
  } else {
    switch (positionals[0]) {
      case 'status':
        ;(await import('./cli/manage.ts')).status()
        break
      case 'rename':
        await (await import('./cli/manage.ts')).rename(positionals[1])
        break
      case 'logs':
        ;(await import('./cli/manage.ts')).logs()
        break
      case 'update':
        await (await import('./cli/manage.ts')).update()
        break
      case 'uninstall':
        ;(await import('./cli/manage.ts')).uninstall()
        break
      case 'serve':
        await (await import('./daemon.ts')).serve()
        break
      case 'sign-in':
        await (await import('./cli/manage.ts')).signIn()
        break
      default:
        throw new Error(
          `Unknown command: ${positionals[0]}. Run familiar --help for usage.`,
        )
    }
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
}
