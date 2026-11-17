# The computer agent's image, for the Docker provider: Chromium and the
# agent, run as an unprivileged user whose home is the computer's disk. The
# same image runs the provider's egress proxy (`docker/proxy-main.js`).
#
# Build from the repository root: pnpm --filter @familiar-ai/computer image

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
# system libraries; curl for the shell.
RUN node /agent/node_modules/playwright/cli.js install --with-deps --no-shell chromium \
  && apt-get install -y --no-install-recommends curl ca-certificates \
  && rm -rf /var/lib/apt/lists/* \
  && useradd --create-home --shell /bin/bash computer
USER computer
WORKDIR /home/computer
ENTRYPOINT ["node", "/agent/dist/agent/main.js"]
