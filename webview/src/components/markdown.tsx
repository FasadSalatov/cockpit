import { Fragment, useEffect, useRef, useState, type ComponentPropsWithoutRef } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { common, createLowlight } from 'lowlight'
import { toJsxRuntime } from 'hast-util-to-jsx-runtime'
import { jsx, jsxs } from 'react/jsx-runtime'
import { visit, SKIP } from 'unist-util-visit'
import { post } from '../vscode'

// Подсветка кода: только common-языки (~30). Бандл значительно меньше
// дефолтного highlight.js (~200KB → ~70KB lowlight common).
// Цвета подсветки берутся из CSS-переменных текущей темы.
const lowlight = createLowlight(common)

function highlight(code: string, language?: string) {
  if (language && lowlight.registered(language)) {
    try {
      return lowlight.highlight(language, code)
    } catch {
      return lowlight.highlightAuto(code)
    }
  }
  return lowlight.highlightAuto(code)
}

// rehype плагин: текстовые упоминания файлов (foo/bar.ts:42) → ссылки cockpit:open?...
const FILE_RE =
  /\b([\w./-]+\.(?:ts|tsx|js|jsx|mjs|cjs|mts|cts|css|scss|less|html|json|md|mdx|py|go|rs|java|kt|c|cpp|h|hpp|cs|rb|php|swift|sh|zsh|bash|yml|yaml|toml|sql|prisma|svelte|vue|tf))(?::(\d+))?(?!\w)/g

function fileLinksPlugin() {
  return (tree: any) => {
    visit(tree, 'text', (node: any, index: any, parent: any) => {
      if (!parent || index == null) return
      if (parent.tagName === 'a' || parent.tagName === 'code') return
      const text: string = node.value
      FILE_RE.lastIndex = 0
      if (!FILE_RE.test(text)) return
      FILE_RE.lastIndex = 0
      const out: any[] = []
      let last = 0
      let m: RegExpExecArray | null
      while ((m = FILE_RE.exec(text))) {
        if (m.index > last) out.push({ type: 'text', value: text.slice(last, m.index) })
        const [whole, p, line] = m
        const href = `cockpit:open?path=${encodeURIComponent(p)}${line ? '&line=' + line : ''}`
        out.push({
          type: 'element',
          tagName: 'a',
          properties: { href, className: ['cockpit-file-ref'] },
          children: [{ type: 'text', value: whole }],
        })
        last = m.index + whole.length
      }
      if (last < text.length) out.push({ type: 'text', value: text.slice(last) })
      parent.children.splice(index, 1, ...out)
      return [SKIP, index + out.length]
    })
  }
}

function MermaidBlock({ code }: { code: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const mermaid = (await import('mermaid')).default
        mermaid.initialize({ startOnLoad: false, theme: 'dark', securityLevel: 'strict' })
        const id = 'mermaid-' + Math.random().toString(36).slice(2, 8)
        const { svg } = await mermaid.render(id, code)
        if (!cancelled && ref.current) ref.current.innerHTML = svg
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e))
      }
    })()
    return () => {
      cancelled = true
    }
  }, [code])
  if (error) {
    return (
      <pre className="border border-pixel-coral bg-destructive/10 p-2 font-mono text-xs text-pixel-coral">
        mermaid: {error}
      </pre>
    )
  }
  return <div ref={ref} className="my-3 flex justify-center" />
}

function CodeBlock({ className, children }: ComponentPropsWithoutRef<'code'>) {
  const lang = /language-([\w-]+)/.exec(className ?? '')?.[1]
  const raw = String(children ?? '').replace(/\n$/, '')
  if (lang === 'mermaid') return <MermaidBlock code={raw} />
  const tree = highlight(raw, lang)
  const rendered = toJsxRuntime(tree as any, { Fragment, jsx, jsxs }) as React.ReactNode
  return (
    <code className={`hljs ${lang ? `language-${lang}` : ''}`}>{rendered}</code>
  )
}

function TodoInput(props: ComponentPropsWithoutRef<'input'>) {
  if (props.type === 'checkbox') {
    const { disabled: _ignored, checked, ...rest } = props
    return (
      <input
        {...rest}
        type="checkbox"
        defaultChecked={Boolean(checked)}
        className="size-3.5 cursor-pointer accent-pixel-magenta"
      />
    )
  }
  return <input {...props} />
}

function Pre(props: ComponentPropsWithoutRef<'pre'>) {
  const ref = useRef<HTMLPreElement>(null)
  const [copied, setCopied] = useState(false)

  const copy = async () => {
    const text = ref.current?.innerText ?? ''
    try {
      await navigator.clipboard.writeText(text)
    } catch {
      const ta = document.createElement('textarea')
      ta.value = text
      document.body.appendChild(ta)
      ta.select()
      document.execCommand('copy')
      ta.remove()
    }
    setCopied(true)
    setTimeout(() => setCopied(false), 1200)
  }

  return (
    <div className="group relative my-3 border-2 border-border shadow-[2px_2px_0_0_var(--foreground)]">
      <button
        onClick={copy}
        className="absolute right-1.5 top-1.5 z-10 border border-border bg-card px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 hover:text-pixel-lime"
      >
        {copied ? 'скопировано ✓' : 'copy'}
      </button>
      <pre ref={ref} {...props} />
    </div>
  )
}

function FileLink({ href, children, ...rest }: ComponentPropsWithoutRef<'a'>) {
  if (href?.startsWith('cockpit:open')) {
    const m = href.match(/^cockpit:open\?path=([^&]+)(?:&line=(\d+))?/)
    const path = m?.[1] ? decodeURIComponent(m[1]) : ''
    const line = m?.[2] ? Number(m[2]) : undefined
    return (
      <a
        {...rest}
        href="#"
        onClick={(e) => {
          e.preventDefault()
          post({ type: 'openFile', payload: { path, line } })
        }}
        className="cockpit-file-ref"
      >
        {children}
      </a>
    )
  }
  return (
    <a {...rest} href={href} target="_blank" rel="noreferrer">
      {children}
    </a>
  )
}

export function Markdown({ children }: { children: string }) {
  return (
    <div className="md">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[fileLinksPlugin]}
        components={{ pre: Pre, code: CodeBlock, a: FileLink, input: TodoInput }}
      >
        {children}
      </ReactMarkdown>
    </div>
  )
}
