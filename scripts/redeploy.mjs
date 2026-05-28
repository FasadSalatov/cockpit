// Одна команда: бамп версии → сборка → упаковка → установка в VS Code.
// Версия бампается, чтобы VS Code гарантированно подхватил новую сборку.
import { execSync } from 'node:child_process'
import { readFileSync, writeFileSync, rmSync, readdirSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const run = (cmd) => execSync(cmd, { cwd: root, stdio: 'inherit' })

// 1. Бамп patch-версии
const pkgPath = join(root, 'package.json')
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
const [maj, min, pat] = pkg.version.split('.').map(Number)
pkg.version = `${maj}.${min}.${pat + 1}`
writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n')
console.log(`\n▸ Версия → ${pkg.version}`)

// 2. Чистим старые vsix
for (const f of readdirSync(root)) {
  if (f.startsWith('cockpit-') && f.endsWith('.vsix')) rmSync(join(root, f))
}

// 3. Темы VS Code + сборка + упаковка
run('node scripts/gen-themes.mjs')
run('pnpm build')
run('npx --yes @vscode/vsce@latest package')

// 4. Установка в VS Code (путь к бинарю можно переопределить через VSCODE_BIN)
const candidates = [
  process.env.VSCODE_BIN,
  '/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code',
  '/usr/local/bin/code',
].filter(Boolean)
const code = candidates.find((p) => existsSync(p))
if (!code) {
  console.error('\n✗ Не нашёл бинарь VS Code. Задай VSCODE_BIN=/путь/к/code')
  process.exit(1)
}
run(`"${code}" --install-extension cockpit-${pkg.version}.vsix --force`)

console.log('\n✓ Установлено. Сделай: Cmd+Shift+P → «Developer: Reload Window»')
