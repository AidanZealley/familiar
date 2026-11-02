# @familiar-ai/plugin-web

Brave web search and public-page reading for Familiar. The Node daemon installs this first-party plugin; embedded hosts choose whether to include it. See [Customise your assistant](https://aidanzealley.github.io/familiar/build/customise/) (publishes once GitHub Pages deployment is enabled).

```sh
npm install @familiar-ai/core @familiar-ai/plugin-web
```

```ts
import { webPlugin } from '@familiar-ai/plugin-web'

const options = {
  plugins: [webPlugin()],
  fetch: publicOnlyFetch,
  secrets,
}
// Pass these alongside storage, models, model and timeZone to summonFamiliar.
```

`publicOnlyFetch` and `secrets` are host-owned implementations of core's `PluginFetch` and `SecretStore`. On Node, refuse private destinations at connection time and on every redirect; see the daemon's [guarded fetch](../../apps/daemon/src/fetch.ts). Workers can use their platform fetch. The default export is an already-created plugin.

Search needs a Brave Search API key, set through `familiar.connections.setSecret({ kind: 'plugin', name: 'web' }, 'braveApiKey', key)`. The key is attached only to Brave's search endpoint. Page reading needs no key.

`web_fetch` reads HTTP(S) text, Markdown and HTML, converting HTML with mdream. It runs no page JavaScript and does not support PDFs or images. Reads are limited to 3 MB and 15 seconds; output defaults to 12,000 characters, at most 30,000.

The default converter runs in the host thread. A Node host should isolate conversion using `webPlugin({ convert })`; the `/convert-html` entry exports `convertHtml` for a worker. The daemon uses bounded Piscina workers; see [daemon plugin wiring](../../apps/daemon/src/plugins.ts).
