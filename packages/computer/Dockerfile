# A Familiar's computer, for `dockerHost`: a desktop (TigerVNC's Xvnc and
# the JWM window manager), Chromium and the agent, run as an unprivileged
# user whose home is the computer's disk. The agent listens on a Unix
# socket the host reaches with `docker exec … socat`, and Xvnc on another
# beside it. The same image
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
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright LANG=C.UTF-8
COPY --from=build /agent /agent
# Chromium as the agent's own Playwright version expects it, with its
# system libraries; socat for the host's connection; curl for the shell;
# the display and window manager (whose launcher's terminal is urxvt, a
# dependency); xdotool, xclip and maim for the screen tools.
RUN node /agent/node_modules/playwright/cli.js install --with-deps --no-shell chromium \
  && apt-get install -y --no-install-recommends sudo socat curl ca-certificates \
    tigervnc-standalone-server jwm xdotool xclip maim \
  && rm -rf /var/lib/apt/lists/* \
  && useradd --create-home --shell /bin/bash computer \
  && printf 'computer ALL=(ALL) NOPASSWD: ALL\n' > /etc/sudoers.d/computer \
  && chmod 0440 /etc/sudoers.d/computer \
  && visudo -cf /etc/sudoers.d/computer \
  && install -d -o computer -g computer /run/familiar /run/familiar-proxy \
  && install -d -m 1777 /tmp/.X11-unix
# The desktop's look (JWM's config, Familiar's fonts, wallpaper, launcher
# icon and terminal), and Chrome's policy: no incognito windows, as the
# agent finds the shown tab through its own extension, which can't see them.
COPY packages/computer/desktop /usr/share/familiar-desktop
RUN install -D -m 644 -t /usr/local/share/fonts/familiar /usr/share/familiar-desktop/fonts/* \
  && fc-cache -f \
  && ln -sf /usr/share/familiar-desktop/jwmrc /etc/jwm/system.jwmrc \
  && install -D -m 644 /usr/share/familiar-desktop/chrome-policy.json \
    /etc/opt/chrome_for_testing/policies/managed/familiar.json
# sudo clears proxy environment variables. Apt uses the agent's loopback
# proxy explicitly, which still only reaches the public internet.
RUN printf 'Acquire::http::Proxy "http://127.0.0.1:3128";\nAcquire::https::Proxy "http://127.0.0.1:3128";\n' \
    > /etc/apt/apt.conf.d/80familiar-proxy
USER computer
WORKDIR /home/computer
ENTRYPOINT ["node", "/agent/dist/agent/main.js"]
