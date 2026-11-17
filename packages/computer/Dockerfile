# A Familiar's computer, for `dockerHost`: Chromium and the agent, run as an
# unprivileged user whose home is the computer's disk. The agent listens on
# a Unix socket the host reaches with `docker exec … socat`. The same image
# runs the host's egress proxy (`docker/proxy-main.js`), which listens on a
# socket in /run/familiar-proxy, a volume shared with every computer.
#
# Build from the repository root, for this machine's platform: pnpm image.
# Releases publish it for linux/amd64 and linux/arm64 as one image.

FROM node:24-bookworm-slim AS build
RUN corepack enable
WORKDIR /repo
COPY . .
RUN pnpm install --frozen-lockfile --filter @familiar-ai/computer... \
  && pnpm --filter @familiar-ai/computer build \
  && pnpm --filter @familiar-ai/computer deploy --legacy --prod /agent

FROM node:24-bookworm-slim
# Links the image published on ghcr.io to its repository.
LABEL org.opencontainers.image.source=https://github.com/AidanZealley/familiar
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
COPY --from=build /agent /agent
# Chromium as the agent's own Playwright version expects it, with its
# system libraries; socat for the host's connection; curl for the shell.
RUN node /agent/node_modules/playwright/cli.js install --with-deps --no-shell chromium \
  && apt-get install -y --no-install-recommends socat curl ca-certificates \
  && rm -rf /var/lib/apt/lists/* \
  && useradd --create-home --shell /bin/bash computer \
  && install -d -o computer -g computer /run/familiar /run/familiar-proxy
USER computer
WORKDIR /home/computer
ENTRYPOINT ["node", "/agent/dist/agent/main.js"]
