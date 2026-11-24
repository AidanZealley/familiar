#!/usr/bin/env node
import { parseArgs } from 'node:util'

const help = `Usage: familiar [command]

Run familiar without a command for guided setup.

Commands:
  status    Show the name, service status and URLs
  rename    Change Familiar's name, optionally passing the new name
  restart   Restart the service, such as after changing your plugins
  serve     Run Familiar in the foreground
  sign-in   Sign in with ChatGPT
  update    Update the installed app and restart its service. A release
            updates to the latest release, a build of main to the latest
            build of main. --main or --release switches between them.
  logs      Follow service logs
  uninstall Remove the service, keeping your data

Options:
  -h, --help  Show this help
`

try {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      help: { type: 'boolean', short: 'h' },
      main: { type: 'boolean' },
      release: { type: 'boolean' },
    },
  })
  const source = values.main ? 'main' : values.release ? 'release' : undefined
  if (values.help) {
    console.log(help)
  } else if (values.main && values.release) {
    throw new Error('Choose one of --main and --release.')
  } else if (source && positionals[0] !== 'update') {
    throw new Error('Only update accepts --main or --release.')
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
      case 'restart':
        ;(await import('./cli/manage.ts')).restart()
        break
      case 'logs':
        ;(await import('./cli/manage.ts')).logs()
        break
      case 'update':
        await (await import('./cli/manage.ts')).update(source)
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
