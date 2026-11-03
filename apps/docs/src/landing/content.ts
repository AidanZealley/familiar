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
    label: 'Yours',
    line: 'Installed on your computer and reached at a private address.',
  },
  {
    label: 'Remembers',
    line: 'Keeps your history and files lasting facts away each night, not instantly.',
  },
  {
    label: 'Learns tricks',
    line: 'Picks up new tools through plugins and MCP servers.',
  },
  {
    label: 'Travels',
    line: 'Its portable core can be hosted on Node or Cloudflare.',
  },
  {
    label: 'Moves in',
    line: "Embed Familiar's packages to put it inside another app.",
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

// Browser-hosted demos are planned, not built.
export const demosStub = 'Browser demos are on the way.'
