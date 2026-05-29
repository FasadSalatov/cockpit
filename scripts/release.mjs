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
import { readFileSync, writeFileSync, readdirSync, rmSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
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

// 3. Темы + сборка + упаковка
run('node scripts/gen-themes.mjs')
run('pnpm build')
// --no-dependencies: vsce под капотом дёргает `npm list --production`, который
// не понимает pnpm-структуру node_modules и валится на extraneous packages.
// Содержимое .vsix не страдает — esbuild уже всё забандлил в out/extension.js.
run('npx --yes @vscode/vsce@latest package --no-dependencies')

const vsix = `${pkg.name}-${pkg.version}.vsix`
if (!existsSync(join(root, vsix))) {
  console.error(`✗ Не нашёл ${vsix}`)
  process.exit(1)
}

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
