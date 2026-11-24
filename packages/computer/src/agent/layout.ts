// Where things are in the computers' image, which the Dockerfile puts there
// and the agent and `dockerHost` rely on.

/** The agent's Chrome extension, which its browser loads. */
export const EXTENSION_DIR = '/agent/extension'

/** The proxy's entry point, which `dockerHost` runs in the proxy container. */
export const PROXY_ENTRY = '/agent/proxy.js'

/** Where the agent listens, and `dockerHost` connects. */
export const AGENT_SOCKET = '/run/familiar/agent.sock'

/**
 * Where the computer's display serves VNC (RFB), beside the agent's socket,
 * for a person watching it. Nothing listens on TCP.
 */
export const DISPLAY_SOCKET = '/run/familiar/display.sock'

/**
 * The port on 127.0.0.1 where the agent passes connections on to its
 * `proxySocket`, for `HTTP_PROXY` and `HTTPS_PROXY`.
 */
export const PROXY_PORT = 3128

/**
 * Written by the agent once it has restored a computer made from a new
 * image, with how that went, in the container's own layer: a new container
 * hasn't got it, and one that slept and woke has. The dpkg hook
 * (`restore/record-packages`) records nothing until it exists.
 */
export const RESTORED = '/var/lib/familiar/restored'

/** The packages the image installs on purpose, one per line, sorted. */
export const APT_BASELINE = '/usr/share/familiar/apt-baseline'
