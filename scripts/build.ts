import * as esbuild from 'esbuild';
import { copyFileSync, mkdirSync, existsSync } from 'fs';
import { dirname } from 'path';

const isDev = process.argv.includes('--dev');
const isWatch = process.argv.includes('--watch');

console.log(`[KnightMind] Building (${isDev ? 'dev' : 'prod'})…`);

const sharedOptions: esbuild.BuildOptions = {
  bundle: true,
  sourcemap: isDev ? 'inline' : false,
  minify: !isDev,
  target: 'chrome116',
  tsconfig: './tsconfig.build.json',
  logLevel: 'warning',
};

const entries: esbuild.BuildOptions[] = [
  // Service Worker — ESM required for MV3 `type: "module"`
  {
    ...sharedOptions,
    entryPoints: ['src/background/index.ts'],
    outfile: 'dist/background/index.js',
    format: 'esm',
    platform: 'browser',
  },

  // Offscreen document script
  {
    ...sharedOptions,
    entryPoints: ['src/offscreen/index.ts'],
    outfile: 'dist/offscreen/index.js',
    format: 'esm',
    platform: 'browser',
  },

  // Content script — IIFE (MV3 content scripts run as classic scripts)
  {
    ...sharedOptions,
    entryPoints: ['src/content/index.ts'],
    outfile: 'dist/content/index.js',
    format: 'iife',
    platform: 'browser',
  },

  // Popup
  {
    ...sharedOptions,
    entryPoints: ['src/popup/index.ts'],
    outfile: 'dist/popup/index.js',
    format: 'esm',
    platform: 'browser',
  },
];

// Static assets to copy into dist/
const staticAssets: [string, string][] = [
  ['manifest.json',             'dist/manifest.json'],
  ['src/offscreen/index.html',  'dist/offscreen/index.html'],
  ['src/popup/index.html',      'dist/popup/index.html'],
  ['icons/icon128.png',         'dist/icons/icon128.png'],
];

// Engine binaries — copied from the stockfish npm package at build time
const engineAssets: [string, string][] = [
  ['node_modules/stockfish/bin/stockfish-18-lite-single.js',   'dist/engine/stockfish.js'],
  ['node_modules/stockfish/bin/stockfish-18-lite-single.wasm', 'dist/engine/stockfish.wasm'],
];

function copyAssets(assets: [string, string][], required = true): void {
  for (const [src, dest] of assets) {
    if (!existsSync(src)) {
      if (required) console.warn(`[KnightMind] Missing: ${src}`);
      continue;
    }
    mkdirSync(dirname(dest), { recursive: true });
    copyFileSync(src, dest);
  }
}

async function build(): Promise<void> {
  mkdirSync('dist', { recursive: true });

  if (isWatch) {
    const contexts = await Promise.all(entries.map(e => esbuild.context(e)));
    await Promise.all(contexts.map(c => c.watch()));
    copyAssets(staticAssets);
    copyAssets(engineAssets, false);
    console.log('[KnightMind] Watching for changes…');
  } else {
    await Promise.all(entries.map(e => esbuild.build(e)));
    copyAssets(staticAssets);
    copyAssets(engineAssets, false);
    console.log('[KnightMind] Build complete → dist/');
  }
}

build().catch(err => {
  console.error('[KnightMind] Build failed:', err);
  process.exit(1);
});
