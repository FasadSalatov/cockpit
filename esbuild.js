const esbuild = require('esbuild')

const watch = process.argv.includes('--watch')

const options = {
  entryPoints: ['src/extension.ts'],
  bundle: true,
  outfile: 'out/extension.js',
  platform: 'node',
  format: 'cjs',
  target: 'node18',
  external: ['vscode', '@anthropic-ai/claude-agent-sdk'],
  sourcemap: true,
  logLevel: 'info',
}

async function main() {
  if (watch) {
    const ctx = await esbuild.context(options)
    await ctx.watch()
    console.log('[esbuild] watching extension host…')
  } else {
    await esbuild.build(options)
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
