/** Where the agent listens in the Docker image, and `dockerHost` connects. */
export const AGENT_SOCKET = '/run/familiar/agent.sock'

/**
 * The port on 127.0.0.1 where the agent passes connections on to its
 * `proxySocket`, for `HTTP_PROXY` and `HTTPS_PROXY`.
 */
export const PROXY_PORT = 3128

/**
 * Set to a port, the agent serves MCP over HTTP on it instead, as
 * `cloudflareContainers` starts it. An environment variable reaches the
 * agent the same way everywhere, where a Container's `entrypoint` doesn't:
 * `wrangler dev` appends it to the image's.
 */
export const AGENT_PORT_ENV = 'FAMILIAR_AGENT_PORT'
