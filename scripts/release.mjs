// Полный релиз Cockpit: bump minor, build, package, GitHub Release с vsix.
// Перед запуском: `gh auth login` и доступ к репозиторию.
//
// Дополнительно:
//   COCKPIT_PUBLISH=marketplace pnpm release   — публикация в VS Code Marketplace (vsce publish)
//   COCKPIT_PUBLISH=openvsx pnpm release       — публикация в Open VSX (ovsx publish)
//   COCKPIT_PUBLISH=all pnpm release           — оба маркетплейса + GitHub Release
//
// Marketplace: установи `VSCE_PAT` env с Personal Access Token из Azure DevOps
//   (Marketplace → manage extensions → publisher → PAT)
// Open VSX: `OVSX_PAT` env с токеном из open-vsx.org
import { execSync } from 'node:child_process'
import { readFileSync, writeFileSync, readdirSync, rmSync, existsSync, mkdtempSync, cpSync, copyFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const run = (cmd, opts = {}) => execSync(cmd, { cwd: root, stdio: 'inherit', ...opts })
const PUBLISH = process.env.COCKPIT_PUBLISH ?? 'github'

// 1. Bump minor
const pkgPath = join(root, 'package.json')
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
const [maj, min, pat] = pkg.version.split('.').map(Number)
pkg.version = `${maj}.${min + 1}.0`
writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n')
console.log(`\n▸ Версия → ${pkg.version}`)

// 2. Чистим старые vsix
for (const f of readdirSync(root)) {
  if (f.endsWith('.vsix')) rmSync(join(root, f))
}

// 3. Темы + сборка
run('node scripts/gen-themes.mjs')
run('pnpm build')

// 3.1 Упаковка
// vsce package под капотом дёргает `npm list --production` и с pnpm-структурой
// node_modules валится на extraneous. А --no-dependencies *не включает*
// node_modules в vsix — runtime падает с ERR_MODULE_NOT_FOUND на claude-agent-sdk.
// Workaround: временно перезаливаем node_modules через npm (flat layout +
// package-lock.json), пакуем, потом восстанавливаем pnpm.
console.log('▸ Переустановка node_modules через npm для vsce (временно)…')
rmSync(join(root, 'node_modules'), { recursive: true, force: true })
rmSync(join(root, 'package-lock.json'), { force: true })
run('npm install --omit=dev --legacy-peer-deps --no-audit --no-fund')
run('npx --yes @vscode/vsce@latest package')

const vsix = `${pkg.name}-${pkg.version}.vsix`
if (!existsSync(join(root, vsix))) {
  console.error(`✗ Не нашёл ${vsix}`)
  process.exit(1)
}

console.log('▸ Восстановление pnpm node_modules…')
rmSync(join(root, 'node_modules'), { recursive: true, force: true })
rmSync(join(root, 'package-lock.json'), { force: true })
run('pnpm install --frozen-lockfile')

// 4. Публикация
const tag = `v${pkg.version}`
const notes = `Cockpit ${tag}\n\nИзменения: https://github.com/FasadSalatov/cockpit/compare/v${maj}.${min}.${pat}...${tag}`

if (PUBLISH === 'github' || PUBLISH === 'all') {
  try {
    run('git add -A')
    run(`git commit -m "release: ${tag}"`, { stdio: 'inherit' })
    run(`git tag ${tag}`)
    run(`git push && git push --tags`)
  } catch (e) {
    console.log('(коммит/тег уже могут существовать, продолжаю)')
  }
  run(
    `gh release create ${tag} ${vsix} --title "${tag}" --notes ${JSON.stringify(notes)}`
  )
  console.log(`✓ GitHub Release ${tag} создан`)
}

if (PUBLISH === 'marketplace' || PUBLISH === 'all') {
  if (!process.env.VSCE_PAT) {
    console.error('✗ VSCE_PAT не задан — пропускаю marketplace')
  } else {
    run(`npx --yes @vscode/vsce@latest publish --packagePath ${vsix}`)
    console.log('✓ Опубликовано в VS Code Marketplace')
  }
}

if (PUBLISH === 'openvsx' || PUBLISH === 'all') {
  if (!process.env.OVSX_PAT) {
    console.error('✗ OVSX_PAT не задан — пропускаю Open VSX')
  } else {
    run(`npx --yes ovsx@latest publish ${vsix} -p ${process.env.OVSX_PAT}`)
    console.log('✓ Опубликовано в Open VSX')
  }
}

console.log(`\n🦈 Cockpit ${tag} готов`)
