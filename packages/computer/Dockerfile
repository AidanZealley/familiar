# A Familiar's computer, for `dockerHost`: Chromium and the agent, run as an
# unprivileged user whose home is the computer's disk. The agent listens on
# a Unix socket the host reaches with `docker exec … socat`. The same image
# runs the host's egress proxy (`docker/proxy-main.js`).
#
# Build from the repository root: pnpm image

FROM node:24-bookworm-slim AS build
RUN corepack enable
WORKDIR /repo
COPY . .
RUN pnpm install --frozen-lockfile --filter @familiar-ai/computer... \
  && pnpm --filter @familiar-ai/computer build \
  && pnpm --filter @familiar-ai/computer deploy --legacy --prod /agent

FROM node:24-bookworm-slim
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
COPY --from=build /agent /agent
# Chromium as the agent's own Playwright version expects it, with its
# system libraries; socat for the host's connection; curl for the shell.
RUN node /agent/node_modules/playwright/cli.js install --with-deps --no-shell chromium \
  && apt-get install -y --no-install-recommends socat curl ca-certificates \
  && rm -rf /var/lib/apt/lists/* \
  && useradd --create-home --shell /bin/bash computer \
  && install -d -o computer -g computer /run/familiar
USER computer
WORKDIR /home/computer
ENTRYPOINT ["node", "/agent/dist/agent/main.js"]
