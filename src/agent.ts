import type { CanUseTool, PermissionResult } from '@anthropic-ai/claude-agent-sdk'
import type { ImageAttachment, RateLimitInfo, Settings } from './protocol'

const READ_ONLY_TOOLS = ['Read', 'Glob', 'Grep']
const EDIT_TOOLS = ['Edit', 'Write', 'MultiEdit']

function globToRegex(glob: string): RegExp {
  // Поддерживаем *, ** и ? — минимально достаточно для allowlist.
  let re = '^'
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i]
    if (c === '*') {
      if (glob[i + 1] === '*') {
        re += '.*'
        i++
        if (glob[i + 1] === '/') i++
      } else {
        re += '[^/]*'
      }
    } else if (c === '?') {
      re += '[^/]'
    } else if ('.+^${}()|[]\\'.includes(c)) {
      re += '\\' + c
    } else {
      re += c
    }
  }
  return new RegExp(re + '$')
}

function pathAllowed(filePath: string, allowedPatterns: string[], cwd?: string): boolean {
  if (allowedPatterns.length === 0) return true
  let rel = filePath
  if (cwd && filePath.startsWith(cwd)) {
    rel = filePath.slice(cwd.length).replace(/^[/\\]+/, '')
  }
  rel = rel.replace(/\\/g, '/')
  for (const pat of allowedPatterns) {
    try {
      if (globToRegex(pat).test(rel)) return true
    } catch {
      if (rel.includes(pat)) return true
    }
  }
  return false
}

export interface AgentEvents {
  onSession: (id: string) => void
  onStreamStart: () => void
  onDelta: (text: string) => void
  onTool: (name: string) => void
  onResult: (summary: {
    costUsd: number
    turns: number
    inputTokens?: number
    outputTokens?: number
    cacheReadTokens?: number
    cacheCreationTokens?: number
  }) => void
  onError: (message: string) => void
  requestPermission: (tool: string, input: Record<string, unknown>) => Promise<boolean>
  onRateLimit?: (info: RateLimitInfo) => void
}

export interface RunOptions {
  cwd?: string
  resume?: string
  token: string
  model?: string
  settings?: Settings
  attachments?: ImageAttachment[]
  onControl?: (interrupt: () => void) => void
}

function buildCanUseTool(
  ev: AgentEvents,
  policy: Settings['autoApprove'],
  disallowBashPatterns: string[],
  allowedEditGlobs: string[],
  cwd?: string
): CanUseTool {
  return async (toolName, input): Promise<PermissionResult> => {
    if (READ_ONLY_TOOLS.includes(toolName)) return { behavior: 'allow' }

    if (toolName === 'Bash' && disallowBashPatterns.length) {
      const cmd = String((input as any)?.command ?? '')
      for (const pat of disallowBashPatterns) {
        try {
          if (new RegExp(pat).test(cmd))
            return { behavior: 'deny', message: `Команда подпадает под запрет: ${pat}` }
        } catch {
          if (cmd.includes(pat))
            return { behavior: 'deny', message: `Команда подпадает под запрет: ${pat}` }
        }
      }
    }

    if (EDIT_TOOLS.includes(toolName) && allowedEditGlobs.length) {
      const fp = String((input as any)?.file_path ?? '')
      if (fp && !pathAllowed(fp, allowedEditGlobs, cwd)) {
        return {
          behavior: 'deny',
          message: `Путь \`${fp}\` вне allowed_edit_paths.`,
        }
      }
    }

    if (policy === 'all') return { behavior: 'allow' }
    if (policy === 'edits' && EDIT_TOOLS.includes(toolName)) return { behavior: 'allow' }

    const approved = await ev.requestPermission(toolName, input)
    return approved
      ? { behavior: 'allow' }
      : { behavior: 'deny', message: 'Действие отклонено пользователем.' }
  }
}

function buildPromptStream(text: string, attachments: ImageAttachment[]) {
  const content: any[] = [
    ...attachments.map((a) => ({
      type: 'image',
      source: { type: 'base64', media_type: a.mediaType, data: a.data },
    })),
    { type: 'text', text },
  ]
  return (async function* () {
    yield {
      type: 'user',
      message: { role: 'user', content },
      session_id: '',
      parent_tool_use_id: null,
    } as any
  })()
}

export async function runPrompt(text: string, opts: RunOptions, ev: AgentEvents): Promise<void> {
  process.env.CLAUDE_CODE_OAUTH_TOKEN = opts.token
  delete process.env.ANTHROPIC_API_KEY

  const { query } = await import('@anthropic-ai/claude-agent-sdk')

  const settings = opts.settings
  const policy: Settings['autoApprove'] = settings?.autoApprove ?? 'asking'
  const disallowBash = (settings?.customDisallowBash ?? '')
    .split(/\s+/)
    .map((s) => s.trim())
    .filter(Boolean)
  const allowedEditGlobs = (settings?.allowedEditPaths ?? '')
    .split(/\s+/)
    .map((s) => s.trim())
    .filter(Boolean)
  const canUseTool = buildCanUseTool(ev, policy, disallowBash, allowedEditGlobs, opts.cwd)

  const hasImages = !!opts.attachments?.length
  const prompt = hasImages ? buildPromptStream(text, opts.attachments!) : text

  const systemPrompt = settings?.systemPrompt?.trim()
    ? ({ type: 'preset', preset: 'claude_code', append: settings.systemPrompt } as const)
    : undefined

  let mcpServers: Record<string, unknown> | undefined
  if (settings?.mcpServers?.trim()) {
    try {
      const parsed = JSON.parse(settings.mcpServers)
      if (parsed && typeof parsed === 'object') mcpServers = parsed
    } catch (e) {
      ev.onError(`MCP servers JSON: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  try {
    const q = query({
      prompt: prompt as any,
      options: {
        cwd: opts.cwd,
        resume: opts.resume,
        model: opts.model && opts.model !== 'default' ? opts.model : undefined,
        allowedTools: [
          ...READ_ONLY_TOOLS,
          ...(settings?.webSearch ? ['WebSearch'] : []),
          ...(settings?.webFetch ? ['WebFetch'] : []),
        ],
        canUseTool,
        includePartialMessages: true,
        maxTurns: settings?.maxTurns && settings.maxTurns > 0 ? settings.maxTurns : undefined,
        systemPrompt,
        mcpServers,
      } as any,
    })
    opts.onControl?.(() => {
      void q.interrupt()
    })
    for await (const msg of q) {
      if ('session_id' in msg && msg.session_id) ev.onSession(msg.session_id)
      if (msg.type === 'stream_event') {
        const event = msg.event
        if (event.type === 'message_start') ev.onStreamStart()
        else if (event.type === 'content_block_start') {
          const block = event.content_block
          if (block.type === 'tool_use') ev.onTool(block.name)
        } else if (event.type === 'content_block_delta') {
          if (event.delta.type === 'text_delta') ev.onDelta(event.delta.text)
        }
      } else if (msg.type === 'assistant') {
        if (msg.error) ev.onError(`Ошибка ассистента: ${msg.error}`)
      } else if ((msg as any).type === 'rate_limit_event') {
        const info = (msg as any).rate_limit_info as RateLimitInfo | undefined
        if (info) ev.onRateLimit?.(info)
      } else if (msg.type === 'result') {
        if (msg.subtype === 'success') {
          const u: any = (msg as any).usage ?? {}
          ev.onResult({
            costUsd: msg.total_cost_usd,
            turns: msg.num_turns,
            inputTokens: u.input_tokens,
            outputTokens: u.output_tokens,
            cacheReadTokens: u.cache_read_input_tokens,
            cacheCreationTokens: u.cache_creation_input_tokens,
          })
        } else {
          ev.onError(`Запрос завершился с ошибкой: ${msg.subtype}`)
        }
      }
    }
  } catch (e) {
    ev.onError(e instanceof Error ? e.message : String(e))
  }
}
