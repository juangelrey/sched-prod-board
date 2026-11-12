// Copies app/ to dist/ and stamps the git sha of HEAD into the page (R6).
import { execSync } from 'node:child_process';
import { cpSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
const sha = execSync('git rev-parse HEAD').toString().trim();
if (execSync('git status --porcelain app').toString().trim()) throw new Error('app/ has uncommitted changes; commit first so the sha names this build');
rmSync('dist', { recursive: true, force: true });
cpSync('app', 'dist', { recursive: true });
writeFileSync('dist/index.html', readFileSync('dist/index.html', 'utf8').replaceAll('__BUILD_SHA__', sha));
console.log('built', sha);
