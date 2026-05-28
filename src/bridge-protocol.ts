/**
 * Wire-protocol for Cockpit-Bridge. Same shape as
 * `unyly/src/lib/cockpit/protocol.ts` — keep both in sync.
 */

export type Role = 'user' | 'assistant' | 'system' | 'tool'

// host → hub → phone
export type ServerEvent =
  | { t: 'instance.online'; instanceId: string; label?: string; workspace?: string }
  | { t: 'instance.offline'; instanceId: string }
  | {
      t: 'session.opened'
      instanceId: string
      sessionId: string
      title?: string
      createdAt: number
    }
  | { t: 'session.closed'; instanceId: string; sessionId: string }
  | {
      t: 'msg.delta'
      instanceId: string
      sessionId: string
      role: Role
      seq: number
      deltaText: string
    }
  | {
      t: 'msg.done'
      instanceId: string
      sessionId: string
      role: Role
      seq: number
      finalText: string
      costMs?: number
    }
  | {
      t: 'diff.proposed'
      instanceId: string
      sessionId: string
      diffId: string
      files: { path: string; additions: number; deletions: number; patch?: string }[]
    }
  | {
      t: 'diff.resolved'
      instanceId: string
      sessionId: string
      diffId: string
      decision: 'approve' | 'reject'
    }
  | { t: 'tree.snapshot'; instanceId: string; paths: string[]; rootPath?: string }
  | { t: 'file.content'; instanceId: string; path: string; content: string; truncated: boolean }

// phone → hub → host
export type ClientCommand =
  | { t: 'subscribe'; instanceId: string; sessionId?: string }
  | { t: 'prompt.send'; instanceId: string; sessionId: string; text: string }
  | {
      t: 'diff.decide'
      instanceId: string
      sessionId: string
      diffId: string
      decision: 'approve' | 'reject'
    }
  | { t: 'tree.request'; instanceId: string; path?: string }
  | { t: 'file.request'; instanceId: string; path: string }
  | { t: 'session.switch'; instanceId: string; sessionId: string }

export type Lifecycle =
  | { t: 'hello'; role: 'host' | 'phone' }
  | { t: 'ping' }
  | { t: 'pong' }
  | { t: 'error'; code: string; message?: string }
  | { t: 'ack'; refId?: string }

export type AnyMessage = ServerEvent | ClientCommand | Lifecycle
