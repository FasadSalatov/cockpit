import * as vscode from 'vscode'
import * as path from 'path'
import { randomUUID } from 'crypto'
import WebSocket from 'ws'
import type { HostToWebview, PermissionDetail } from './protocol'
import type { AnyMessage, ServerEvent } from './bridge-protocol'

const BRIDGE_PAIR_KEY = 'cockpit.bridge.pairKey'
const BRIDGE_INSTANCE_ID = 'cockpit.bridge.instanceId'
const BRIDGE_HUB_URL_KEY = 'cockpit.bridge.hubUrl'
const BRIDGE_PAIRED_AT_KEY = 'cockpit.bridge.pairedAt'
const BRIDGE_PAIR_LABEL_KEY = 'cockpit.bridge.pairLabel'
const DEFAULT_HUB = 'wss://unyly.org/cockpit/ws'

const RECONNECT_BACKOFF_MS = [1_000, 2_000, 5_000, 10_000, 30_000]
const MAX_FILE_BYTES = 200 * 1024

const DIR_BLACKLIST = new Set([
  '.git',
  'node_modules',
  '.next',
  '.next.new',
  'dist',
  'build',
  'out',
  'target',
  '.cache',
  '.turbo',
  '.parcel-cache',
  '.pnpm-store',
])

const BINARY_EXT = new Set([
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'ico', 'bmp', 'tiff',
  'mp3', 'mp4', 'mov', 'avi', 'wav', 'ogg', 'webm', 'm4a',
  'zip', 'tar', 'gz', 'bz2', '7z', 'rar', 'xz',
  'exe', 'dll', 'so', 'dylib', 'bin', 'class', 'jar',
  'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx',
  'woff', 'woff2', 'ttf', 'otf', 'eot',
  'db', 'sqlite', 'sqlite3',
])

function isPathSafe(rel: string): boolean {
  if (rel.startsWith('/') || rel.includes('..')) return false
  const parts = rel.split(/[/\\]/)
  for (const p of parts) {
    if (DIR_BLACKLIST.has(p)) return false
    if (p.startsWith('.env')) return false
  }
  const ext = (rel.split('.').pop() || '').toLowerCase()
  if (BINARY_EXT.has(ext)) return false
  return true
}

export type PhoneCallbacks = {
  onPhonePrompt: (sessionId: string, text: string) => Promise<void> | void
  onPhoneDiffDecision: (diffId: string, decision: 'approve' | 'reject') => void
  onPhoneSessionSwitch: (sessionId: string) => Promise<void> | void
  /** Get the cockpit-side sessionId currently considered "active". */
  getActiveSessionId: () => string | undefined
  /**
   * Return ALL sessions cockpit currently knows of — pushed once per WS
   * connect so the miniapp shows the full list even before any messages
   * have flowed through the hub.
   */
  getInitialSessions?: () => Promise<
    Array<{
      sessionId: string
      title?: string
      firstPrompt?: string
      cwd?: string
      lastModified?: number
    }>
  >
}

export class BridgeHost implements vscode.Disposable {
  private context: vscode.ExtensionContext
  private callbacks: PhoneCallbacks
  private ws: WebSocket | null = null
  private connected = false
  private pairKey: string | null = null
  private instanceId: string
  private hubUrl: string
  private reconnectAttempt = 0
  private reconnectTimer: NodeJS.Timeout | null = null
  private pingTimer: NodeJS.Timeout | null = null
  private streams = new Map<string, { seq: number; text: string }>()
  private nextSeq = 1
  private outputChannel: vscode.OutputChannel

  constructor(context: vscode.ExtensionContext, callbacks: PhoneCallbacks) {
    this.context = context
    this.callbacks = callbacks
    this.hubUrl = context.globalState.get<string>(BRIDGE_HUB_URL_KEY) || DEFAULT_HUB
    const stored = context.globalState.get<string>(BRIDGE_INSTANCE_ID)
    this.instanceId = stored || randomUUID()
    if (!stored) void context.globalState.update(BRIDGE_INSTANCE_ID, this.instanceId)
    this.outputChannel = vscode.window.createOutputChannel('Cockpit Bridge')
    context.subscriptions.push(this.outputChannel)
  }

  async init(): Promise<void> {
    this.pairKey = (await this.context.secrets.get(BRIDGE_PAIR_KEY)) || null
    if (this.pairKey) this.connect()
  }

  isPaired(): boolean {
    return Boolean(this.pairKey)
  }

  getInstanceId(): string {
    return this.instanceId
  }

  getStatus(): { paired: boolean; instanceId: string; pairedAt?: number; pairLabel?: string } {
    const pairedAt = this.context.globalState.get<number>(BRIDGE_PAIRED_AT_KEY)
    const pairLabel = this.context.globalState.get<string>(BRIDGE_PAIR_LABEL_KEY)
    return {
      paired: Boolean(this.pairKey),
      instanceId: this.instanceId,
      pairedAt: pairedAt ?? undefined,
      pairLabel: pairLabel ?? undefined,
    }
  }

  /** Cockpit Settings UI calls this after a successful /pair/claim. */
  async setPairKey(pairKey: string, label?: string): Promise<void> {
    await this.context.secrets.store(BRIDGE_PAIR_KEY, pairKey)
    await this.context.globalState.update(BRIDGE_PAIRED_AT_KEY, Date.now())
    if (label !== undefined) {
      await this.context.globalState.update(BRIDGE_PAIR_LABEL_KEY, label)
    }
    this.pairKey = pairKey
    this.disconnect()
    this.connect()
  }

  async revoke(): Promise<void> {
    // Tell the hub first — it marks the pair revoked + drops phone sockets,
    // so the miniapp lands on the unpaired splash instead of dangling on a
    // dead pair_key. Then wipe local state.
    const oldKey = this.pairKey
    if (oldKey) {
      try {
        await fetch('https://unyly.org/api/cockpit/pair/cockpit-revoke', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ pairKey: oldKey }),
        })
      } catch (e) {
        this.log(`cockpit-revoke fetch failed: ${(e as Error).message}`)
      }
    }
    await this.context.secrets.delete(BRIDGE_PAIR_KEY)
    await this.context.globalState.update(BRIDGE_PAIRED_AT_KEY, undefined)
    await this.context.globalState.update(BRIDGE_PAIR_LABEL_KEY, undefined)
    this.pairKey = null
    this.disconnect()
  }

  dispose(): void {
    this.disconnect()
  }

  // ── connection lifecycle ──────────────────────────────────────────────────

  private connect(): void {
    if (!this.pairKey) return
    if (this.ws) return
    const workspace = vscode.workspace.workspaceFolders?.[0]
    const params = new URLSearchParams({
      role: 'host',
      pair_key: this.pairKey,
      instance_id: this.instanceId,
    })
    const label = workspace?.name
    const ws = workspace?.uri.fsPath
    if (label) params.set('label', label)
    if (ws) params.set('workspace', ws)
    const url = `${this.hubUrl}?${params}`
    this.log(`connecting → ${this.hubUrl}`)
    try {
      this.ws = new WebSocket(url)
    } catch (e) {
      this.log(`WebSocket ctor failed: ${(e as Error).message}`)
      this.scheduleReconnect()
      return
    }
    this.ws.on('open', () => this.onOpen())
    this.ws.on('message', (raw: WebSocket.RawData) => this.onMessage(raw))
    this.ws.on('close', (code: number, reason: Buffer) => this.onClose(code, reason.toString()))
    this.ws.on('error', (err: Error) => this.log(`ws error: ${err.message}`))
    this.ws.on('pong', () => {
      // keep-alive — server pings us, we pong back automatically (ws lib).
    })
  }

  private disconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    if (this.pingTimer) {
      clearInterval(this.pingTimer)
      this.pingTimer = null
    }
    const w = this.ws
    this.ws = null
    this.connected = false
    if (w) {
      try {
        w.close(1000, 'client_disconnect')
      } catch {}
    }
  }

  private onOpen(): void {
    this.connected = true
    this.reconnectAttempt = 0
    this.log('connected')
    // Server already counts this socket as the host for the room — no need to
    // send instance.online (it does that on our behalf via the upgrade auth).
    this.pingTimer = setInterval(() => {
      try {
        this.ws?.ping()
      } catch {}
    }, 25_000)
    // Push the full session list to the hub so the miniapp can render every
    // chat — even ones that never had a message stream through the bridge.
    void this.pushInitialSessions()
  }

  private async pushInitialSessions(): Promise<void> {
    const fetcher = this.callbacks.getInitialSessions
    if (!fetcher) return
    try {
      const sessions = await fetcher()
      if (!sessions || sessions.length === 0) {
        this.log('getInitialSessions returned 0 — nothing to snapshot')
        return
      }
      this.send({
        t: 'session.snapshot',
        instanceId: this.instanceId,
        sessions,
      } as ServerEvent)
      this.log(`session.snapshot sent (${sessions.length})`)
    } catch (e) {
      this.log(`getInitialSessions failed: ${(e as Error).message}`)
    }
  }

  private onClose(code: number, reason: string): void {
    this.connected = false
    if (this.pingTimer) {
      clearInterval(this.pingTimer)
      this.pingTimer = null
    }
    this.ws = null
    this.log(`closed (code=${code} reason=${reason || '<none>'})`)
    // 4401 = revoked by phone — stop reconnecting.
    if (code === 4401) return
    if (!this.pairKey) return
    this.scheduleReconnect()
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return
    const delay = RECONNECT_BACKOFF_MS[Math.min(this.reconnectAttempt, RECONNECT_BACKOFF_MS.length - 1)]
    this.reconnectAttempt++
    this.log(`reconnect in ${delay}ms (attempt ${this.reconnectAttempt})`)
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      this.connect()
    }, delay)
  }

  // ── inbound (phone → host) ────────────────────────────────────────────────

  private onMessage(raw: WebSocket.RawData): void {
    let msg: AnyMessage
    try {
      msg = JSON.parse(typeof raw === 'string' ? raw : raw.toString('utf8'))
    } catch {
      return
    }
    if (!msg || typeof (msg as { t?: unknown }).t !== 'string') return

    switch (msg.t) {
      case 'hello':
      case 'ack':
      case 'pong':
        return
      case 'ping':
        this.send({ t: 'pong' })
        return
      case 'error':
        this.log(`hub error: ${msg.code} ${msg.message ?? ''}`)
        return

      case 'prompt.send':
        if (msg.instanceId !== this.instanceId) return
        void this.callbacks.onPhonePrompt(msg.sessionId, msg.text)
        return

      case 'diff.decide':
        if (msg.instanceId !== this.instanceId) return
        this.callbacks.onPhoneDiffDecision(msg.diffId, msg.decision)
        return

      case 'session.switch':
        if (msg.instanceId !== this.instanceId) return
        void this.callbacks.onPhoneSessionSwitch(msg.sessionId)
        return

      case 'tree.request':
        if (msg.instanceId !== this.instanceId) return
        void this.handleTreeRequest(msg.path)
        return

      case 'file.request':
        if (msg.instanceId !== this.instanceId) return
        void this.handleFileRequest(msg.path)
        return

      default:
        return
    }
  }

  // ── outbound (host → phone) ───────────────────────────────────────────────

  /** Called from extension.ts after every postToMain. */
  observeHostToWebview(msg: HostToWebview, sessionId: string | undefined): void {
    if (!this.connected || !sessionId) return
    switch (msg.type) {
      case 'streamStart':
        this.streams.set(sessionId, { seq: this.nextSeq++, text: '' })
        break

      case 'delta': {
        const s = this.streams.get(sessionId)
        if (!s) break
        s.text += msg.payload.text
        this.send({
          t: 'msg.delta',
          instanceId: this.instanceId,
          sessionId,
          role: 'assistant',
          seq: s.seq,
          deltaText: msg.payload.text,
        })
        break
      }

      case 'result': {
        const s = this.streams.get(sessionId)
        if (s) {
          this.send({
            t: 'msg.done',
            instanceId: this.instanceId,
            sessionId,
            role: 'assistant',
            seq: s.seq,
            finalText: s.text,
          })
          this.streams.delete(sessionId)
        }
        break
      }

      case 'error': {
        this.send({
          t: 'msg.done',
          instanceId: this.instanceId,
          sessionId,
          role: 'system',
          seq: this.nextSeq++,
          finalText: `❌ ${msg.payload.message}`,
        })
        this.streams.delete(sessionId)
        break
      }

      case 'tool':
        // Tool-use is wire-only (no persist) — emit a delta the phone can show
        // as an inline pill.
        this.send({
          t: 'msg.delta',
          instanceId: this.instanceId,
          sessionId,
          role: 'tool',
          seq: this.nextSeq++,
          deltaText: msg.payload.name,
        })
        break

      case 'permission':
        this.emitDiffProposed(sessionId, msg.payload.id, msg.payload.detail)
        break

      default:
        break
    }
  }

  /** Tell phones a brand-new session was created/loaded. */
  notifySessionOpened(sessionId: string, title?: string): void {
    if (!this.connected) return
    this.send({
      t: 'session.opened',
      instanceId: this.instanceId,
      sessionId,
      title,
      createdAt: Math.floor(Date.now() / 1000),
    })
  }

  notifySessionClosed(sessionId: string): void {
    if (!this.connected) return
    this.send({ t: 'session.closed', instanceId: this.instanceId, sessionId })
  }

  /** Phone marked a diff resolved (echo back so other phones in the room see it). */
  notifyDiffResolved(sessionId: string, diffId: string, decision: 'approve' | 'reject'): void {
    if (!this.connected) return
    this.send({
      t: 'diff.resolved',
      instanceId: this.instanceId,
      sessionId,
      diffId,
      decision,
    })
  }

  // ── file-server ──────────────────────────────────────────────────────────

  private async handleTreeRequest(reqPath?: string): Promise<void> {
    const root = vscode.workspace.workspaceFolders?.[0]
    if (!root) return
    const relRoot = reqPath?.trim() || ''
    if (relRoot && !isPathSafe(relRoot)) return
    const baseUri = relRoot ? vscode.Uri.joinPath(root.uri, relRoot) : root.uri
    const paths: string[] = []
    try {
      const entries = await vscode.workspace.fs.readDirectory(baseUri)
      for (const [name, type] of entries) {
        const isDir = (type & vscode.FileType.Directory) !== 0
        if (DIR_BLACKLIST.has(name)) continue
        if (name.startsWith('.env')) continue
        const rel = relRoot ? `${relRoot}/${name}` : name
        paths.push(isDir ? `${rel}/` : rel)
      }
    } catch (e) {
      this.log(`tree.request error: ${(e as Error).message}`)
      return
    }
    paths.sort()
    this.send({
      t: 'tree.snapshot',
      instanceId: this.instanceId,
      paths,
      rootPath: relRoot || '/',
    })
  }

  private async handleFileRequest(reqPath: string): Promise<void> {
    const root = vscode.workspace.workspaceFolders?.[0]
    if (!root) return
    if (!reqPath || !isPathSafe(reqPath)) return
    const uri = vscode.Uri.joinPath(root.uri, reqPath)
    try {
      const stat = await vscode.workspace.fs.stat(uri)
      if ((stat.type & vscode.FileType.Directory) !== 0) return
      const truncated = stat.size > MAX_FILE_BYTES
      const bytes = await vscode.workspace.fs.readFile(uri)
      const slice = truncated ? bytes.slice(0, MAX_FILE_BYTES) : bytes
      this.send({
        t: 'file.content',
        instanceId: this.instanceId,
        path: reqPath,
        content: Buffer.from(slice).toString('utf8'),
        truncated,
      })
    } catch (e) {
      this.log(`file.request error: ${(e as Error).message}`)
    }
  }

  // ── helpers ──────────────────────────────────────────────────────────────

  private emitDiffProposed(sessionId: string, diffId: string, detail: PermissionDetail): void {
    if (detail.kind !== 'edit' && detail.kind !== 'write') return
    const file = detail.file
    const fileEntry: { path: string; additions: number; deletions: number; patch?: string } = {
      path: file,
      additions: 0,
      deletions: 0,
    }
    if (detail.kind === 'edit') {
      fileEntry.additions = countLines(detail.newText)
      fileEntry.deletions = countLines(detail.oldText)
      fileEntry.patch = `- ${detail.oldText}\n+ ${detail.newText}`
    } else {
      fileEntry.additions = countLines(detail.content)
      fileEntry.patch = detail.content
    }
    this.send({
      t: 'diff.proposed',
      instanceId: this.instanceId,
      sessionId,
      diffId,
      files: [fileEntry],
    })
  }

  private send(msg: ServerEvent | { t: 'pong' }): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return
    try {
      this.ws.send(JSON.stringify(msg))
    } catch (e) {
      this.log(`send failed: ${(e as Error).message}`)
    }
  }

  private log(line: string): void {
    this.outputChannel.appendLine(`[${new Date().toISOString()}] ${line}`)
  }
}

function countLines(s: string): number {
  if (!s) return 0
  return s.split('\n').length
}
