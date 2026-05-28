import type { HostToWebview, WebviewToHost } from '../../src/protocol'

interface VsCodeApi {
  postMessage(msg: WebviewToHost): void
  getState<T>(): T | undefined
  setState<T>(state: T): void
}

declare function acquireVsCodeApi(): VsCodeApi

export const vscode = acquireVsCodeApi()

export function post(msg: WebviewToHost) {
  vscode.postMessage(msg)
}

export function onMessage(handler: (msg: HostToWebview) => void): () => void {
  const listener = (event: MessageEvent<HostToWebview>) => handler(event.data)
  window.addEventListener('message', listener)
  return () => window.removeEventListener('message', listener)
}
