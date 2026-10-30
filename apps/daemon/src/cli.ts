import { parseArgs } from 'node:util'

const help = `Usage: familiar <command>

Commands:
  serve     Run Familiar in the foreground
  sign-in   Sign in with ChatGPT

Options:
  -h, --help  Show this help
`

try {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: { help: { type: 'boolean', short: 'h' } },
  })
  if (values.help || positionals.length === 0) {
    console.log(help)
  } else if (positionals.length !== 1) {
    throw new Error('Expected one command. Run familiar --help for usage.')
  } else {
    switch (positionals[0]) {
      case 'serve':
        await (await import('./daemon.ts')).serve()
        break
      case 'sign-in':
        await (await import('./sign-in.ts')).signIn()
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
