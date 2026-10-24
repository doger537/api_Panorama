import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
for (const [entry, args] of [['typescript', ['--noEmit']], ['vite', ['build']]]) {
  const result = spawnSync(process.execPath, [resolve(dirname(require.resolve(`${entry}/package.json`)), entry === 'vite' ? 'bin/vite.js' : 'bin/tsc'), ...args], { stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
