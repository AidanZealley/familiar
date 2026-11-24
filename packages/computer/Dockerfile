# A Familiar's computer, for `dockerHost`: a desktop (TigerVNC's Xvnc and
# the JWM window manager), Chromium and the agent, run as an unprivileged
# user whose home is the computer's disk. The agent listens on a Unix
# socket the host reaches with `docker exec … socat`, and Xvnc on another
# beside it. The same image runs the host's egress proxy (`/agent/proxy.js`),
# which listens on a socket in /run/familiar-proxy, a volume shared with
# every computer. Paths the agent and host rely on are in src/agent/layout.ts.
#
# scripts/image-key.ts stages this image's build context and names the image
# by its hash: `pnpm image` builds it for this machine's platform, and CI
# publishes it for linux/amd64 and linux/arm64 when that name is new.

# Pinned, so a new base image is a change here, and so a new image.
FROM node:24-bookworm-slim@sha256:873f586f3794f52281bd039bf02c048a0be08fde619338f9941bad1eb6b34530
# Links the image published on ghcr.io to its repository.
LABEL org.opencontainers.image.source=https://github.com/AidanZealley/familiar
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright LANG=C.UTF-8
# Changed to rebuild the image on purpose, such as for Debian's security
# updates, when nothing else has. Each change replaces every computer, so it's
# a reviewed commit, not a schedule.
ARG IMAGE_REFRESH=2026-11
# Playwright, at the version the computer package pins, and Chromium as it
# expects it, with its system libraries; socat for the host's connection;
# curl for the shell; the display and window manager (whose launcher's
# terminal is urxvt, a dependency); xdotool, xclip and maim for the screen
# tools.
COPY package.json /agent/
RUN cd /agent && npm install --omit=dev --no-audit --no-fund && rm -rf /root/.npm \
  && node /agent/node_modules/playwright/cli.js install --with-deps --no-shell chromium \
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
COPY desktop /usr/share/familiar-desktop
RUN install -D -m 644 -t /usr/local/share/fonts/familiar /usr/share/familiar-desktop/fonts/* \
  && fc-cache -f \
  && ln -sf /usr/share/familiar-desktop/jwmrc /etc/jwm/system.jwmrc \
  && install -D -m 644 /usr/share/familiar-desktop/chrome-policy.json \
    /etc/opt/chrome_for_testing/policies/managed/familiar.json
# sudo clears proxy environment variables. Apt uses the agent's loopback
# proxy explicitly, which still only reaches the public internet.
RUN printf 'Acquire::http::Proxy "http://127.0.0.1:3128";\nAcquire::https::Proxy "http://127.0.0.1:3128";\n' \
    > /etc/apt/apt.conf.d/80familiar-proxy
# Restoring a computer made again from a newer image (src/agent/restore.ts):
# the packages the image itself installs on purpose, and a dpkg hook that
# records the ones people add, in ~/.familiar/apt-packages. Last of the apt
# work, so the image's own installs aren't recorded.
COPY --chmod=755 restore/record-packages /usr/share/familiar/record-packages
RUN apt-mark showmanual | LC_ALL=C sort > /usr/share/familiar/apt-baseline \
  && printf 'post-invoke="/usr/share/familiar/record-packages || true"\n' \
    > /etc/dpkg/dpkg.cfg.d/familiar-record \
  && install -d -o computer -g computer /var/lib/familiar
# The agent and the proxy, each bundled into one file, and the agent's
# browser extension.
COPY agent.js proxy.js /agent/
COPY extension /agent/extension
USER computer
WORKDIR /home/computer
ENTRYPOINT ["node", "/agent/agent.js"]
