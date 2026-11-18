/** Where the agent listens in the Docker image, and `dockerHost` connects. */
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
