// The part of noVNC's RFB client the web app uses: it ships no types.
declare module '@novnc/novnc' {
  export default class RFB extends EventTarget {
    constructor(
      target: HTMLElement,
      urlOrChannel: string | WebSocket,
      options?: { shared?: boolean },
    )
    viewOnly: boolean
    scaleViewport: boolean
    resizeSession: boolean
    focusOnClick: boolean
    background: string
    disconnect(): void
    toDataURL(type?: string, encoderOptions?: number): string
  }
}
