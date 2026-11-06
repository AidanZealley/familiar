import starlight from '@astrojs/starlight'
import { defineConfig } from 'astro/config'

const repository = 'https://github.com/AidanZealley/familiar'

// The site reads from outside apps/docs: the packages, the example demos it
// builds and example source pages import with `?raw`. The deploy workflow
// only rebuilds when its `paths` change, so reading from a new folder means
// adding it to `paths` in .github/workflows/docs.yml, or that folder's
// changes never reach the live site.

// GitHub Pages serves this project site from /familiar/. Markdown links
// include that base; `pnpm build:docs` fails on any that don't resolve.
export default defineConfig({
  site: 'https://aidanzealley.github.io',
  base: '/familiar',
  trailingSlash: 'always',
  vite: {
    plugins: [
      {
        // GitHub Pages serves public/demos/<example>/index.html at the folder
        // URL the example pages embed; Astro's dev server doesn't. Astro has
        // removed the base path by the time this sees the URL.
        name: 'serve-demo-index',
        apply: 'serve',
        configureServer(server) {
          server.middlewares.use((request, _response, next) => {
            request.url = request.url?.replace(
              /^(\/demos\/[^/?]+\/)(?=\?|$)/,
              '$1index.html',
            )
            next()
          })
        },
      },
    ],
  },
  integrations: [
    starlight({
      title: 'Familiar',
      description:
        'A personal AI assistant with one ongoing conversation, memory, reminders and tools.',
      social: [
        { icon: 'github', label: 'GitHub', href: repository },
        {
          icon: 'npm',
          label: 'npm',
          href: 'https://www.npmjs.com/org/familiar-ai',
        },
      ],
      editLink: { baseUrl: `${repository}/edit/main/apps/docs/` },
      customCss: [
        '@fontsource-variable/geist',
        '@fontsource-variable/jetbrains-mono',
        './src/styles/theme.css',
      ],
      sidebar: [
        {
          label: 'Use Familiar',
          items: [
            'use/install',
            'use/conversation-and-memory',
            'use/reminders-and-notifications',
            'use/tools-and-connections',
            'use/extend',
            'use/settings-and-maintenance',
          ],
        },
        {
          label: 'Build with Familiar',
          items: [
            'build/overview',
            'build/first-familiar',
            'build/models-and-sign-in',
            'build/serve-the-api',
            'build/connect-a-frontend',
            'build/customise',
            'build/cloudflare',
          ],
        },
        {
          label: 'Examples',
          items: [
            'examples/node-server',
            'examples/shared-conversation',
            'examples/embedded-assistant',
          ],
        },
        {
          label: 'Reference',
          items: [
            'reference/core',
            'reference/http',
            'reference/client',
            'reference/plugins',
          ],
        },
        { label: 'Contribute', items: ['contribute/development'] },
      ],
    }),
  ],
})
