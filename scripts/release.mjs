#!/usr/bin/env node
// Publishes a new version of the Windows app: npm run release -- patch | minor | major | 1.4.0 [--no-check] [--dry]
// It raises the version in desktop/package.json, commits, tags it (v1.4.0) and pushes. The "Windows installer" workflow then builds
// the installer and publishes it (with latest.yml) to GitHub Releases, which is where installed apps look for updates.
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const out = (cmd) => execSync(cmd, { encoding: 'utf8' }).trim();
const run = (cmd) => (dry ? console.log(`[dry run] ${cmd}`) : execSync(cmd, { stdio: 'inherit' }));
const fail = (message) => { console.error(`\n${message}\n`); process.exit(1); };

const [bump = 'patch', ...flags] = process.argv.slice(2);
const dry = flags.includes('--dry');
const current = JSON.parse(readFileSync('desktop/package.json', 'utf8')).version;
const [major, minor, patch] = current.split('.').map(Number);
const next = { major: `${major + 1}.0.0`, minor: `${major}.${minor + 1}.0`, patch: `${major}.${minor}.${patch + 1}` }[bump] ?? bump;

if (!/^\d+\.\d+\.\d+$/.test(next)) fail(`"${bump}" is not patch, minor, major or a version like 1.4.0.`);
if (out('git status --porcelain')) fail('There are uncommitted changes. Commit or stash them first.');
if (out('git branch --show-current') !== 'main') fail('Switch to the main branch first: git checkout main');
run('git pull --ff-only origin main');
if (out(`git tag -l v${next}`)) fail(`The tag v${next} already exists. Pick a higher version.`);
if (!flags.includes('--no-check')) run('npm run check');

console.log(`\nReleasing ${current} -> ${next}\n`);
if (next !== current) { // releasing the version already in package.json (never tagged yet) needs no bump
  run(`npm --prefix desktop version ${next} --no-git-tag-version`);
  run('git add desktop/package.json desktop/package-lock.json');
  run(`git commit -m "Release v${next}"`);
}
run(`git tag -a v${next} -m "Version ${next}"`);
run('git push origin main');
run(`git push origin v${next}`);
console.log(`\nDone. Watch the "Windows installer" run on GitHub Actions; when it finishes, v${next} appears under Releases and installed apps will offer it.`);
