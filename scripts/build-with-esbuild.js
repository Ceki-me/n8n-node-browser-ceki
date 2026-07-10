/**
 * Build script that bundles each node/credential .ts file with esbuild.
 * Inlines all dependencies (@ceki/sdk, ws, mime-types, …) so the
 * published package has zero runtime deps — required for n8n verification.
 *
 * Only n8n-workflow is kept external (it's a peer dep, provided by n8n).
 */

const esbuild = require('esbuild');
const fs = require('fs');
const path = require('path');

/** Recursively find all .ts files under a directory (skips node_modules). */
function findTs(root) {
  const result = [];
  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(abs);
      } else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')) {
        result.push(abs);
      }
    }
  }
  walk(root);
  return result;
}

const entryPoints = [
  ...findTs('nodes'),
  ...findTs('credentials'),
];

console.log(`esbuild: bundling ${entryPoints.length} entry points …`);

const result = esbuild.buildSync({
  entryPoints,
  bundle: true,
  platform: 'node',
  target: 'node22',
  outdir: 'dist',
  outbase: '.',
  external: ['n8n-workflow'],
  sourcemap: true,
  format: 'cjs',
  minifyWhitespace: false,
  logLevel: 'info',
});

if (result.errors.length) {
  console.error('esbuild errors:', result.errors);
  process.exit(1);
}

// Copy icons (the same .png must sit beside each compiled .js)
require('./copy-icons.js');
