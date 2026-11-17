/** Where the agent listens in the Docker image, and `dockerHost` connects. */
export const AGENT_SOCKET = '/run/familiar/agent.sock'

/**
 * The port on 127.0.0.1 where the agent passes connections on to its
 * `proxySocket`, for `HTTP_PROXY` and `HTTPS_PROXY`.
 */
export const PROXY_PORT = 3128
