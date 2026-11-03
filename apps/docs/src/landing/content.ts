export const links = {
  docs: '/familiar/docs/',
  install: '/familiar/use/install/',
  build: '/familiar/build/overview/',
  github: 'https://github.com/AidanZealley/familiar',
  piDurable: 'https://github.com/earendil-works/pi/tree/main/packages/durable',
}

export const headline =
  'A portable AI assistant with memory you can run anywhere and build into your app.'

export const pitch =
  'Familiar runs on your computer, remembers what you tell it and picks up where you left off on any of your devices.'

export const signIn =
  'The installer signs you in with your ChatGPT subscription. No API key needed.'

// Exact commands from the repository README.
export const installers = [
  {
    id: 'unix',
    os: 'macOS and Linux',
    short: 'macOS / Linux',
    prompt: '$',
    command:
      'curl -fsSL https://github.com/AidanZealley/familiar/releases/latest/download/install.sh | sh',
  },
  {
    id: 'windows',
    os: 'Windows',
    short: 'Windows',
    prompt: 'PS>',
    command:
      'irm https://github.com/AidanZealley/familiar/releases/latest/download/install.ps1 | iex',
  },
] as const

export const highlights = [
  {
    label: 'Self-hosted',
    line: 'Run Familiar on your computer and access it over your private network.',
  },
  {
    label: 'Long-term memory',
    line: 'Stores conversation history and organises lasting facts each night.',
  },
  {
    label: 'Tools and plugins',
    line: 'Connect web tools, custom plugins and MCP servers.',
  },
  {
    label: 'Portable',
    line: 'Host the same core on Node.js or Cloudflare Workers.',
  },
  {
    label: 'Embeddable',
    line: "Add an assistant to your app with Familiar's core and client packages.",
  },
] as const

// The two ways to use Familiar.
export const paths = [
  {
    label: 'Use Familiar',
    line: 'Install it, chat, and manage its memory and tools.',
    href: links.install,
  },
  {
    label: 'Build with Familiar',
    line: 'Embed the npm packages in an app of your own.',
    href: links.build,
  },
] as const

// Examples that run in the browser, in the docs.
export const demos = [
  {
    label: 'Embedded assistant',
    href: '/familiar/examples/embedded-assistant/',
  },
  {
    label: 'Shared conversation',
    href: '/familiar/examples/shared-conversation/',
  },
] as const
