/*
 * Builds the desktop app into desktop/stage, a self-contained folder (compiled code + production node_modules
 * rebuilt for Electron). `--run` starts it; `--package` turns the same folder into the Windows installer
 * (desktop/release/Supermarket-POS-Setup.exe, build it on Windows).
 *
 *   node desktop/packaging/stage.mjs [--run | --package] [--no-build]
 */
import { spawn, spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const at = (...parts) => join(root, ...parts);
const stage = at('desktop', 'stage');
const flags = new Set(process.argv.slice(2));

const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'));
const run = (command, args, cwd) => {
  const npmCli = process.env.npm_execpath;
  if (!npmCli) throw new Error('Run this through the root npm scripts (desktop:build, desktop:dev or desktop:package).');
  const cli = command === 'npm' ? npmCli : join(dirname(npmCli), 'npx-cli.js');
  const { status, error } = spawnSync(process.execPath, [cli, ...args], { cwd, stdio: 'inherit' });
  if (error || status !== 0) throw new Error(`"${command} ${args.join(' ')}" failed in ${cwd}`, { cause: error });
};

const build = () => {
  for (const project of ['backend', 'frontend', 'desktop']) {
    rmSync(at(project, 'dist'), { recursive: true, force: true }); // stale files from earlier builds must not be packaged
    run('npm', ['run', 'build'], at(project));
  }
};

/** Backend dependencies pinned to the versions it was built and tested with, plus the desktop shell's own. */
const manifest = () => {
  const backend = readJson(at('backend/package.json'));
  const desktop = readJson(at('desktop/package.json'));
  const pinned = Object.fromEntries(
    Object.keys(backend.dependencies).map((name) => [name, readJson(at('backend/node_modules', name, 'package.json')).version]),
  );
  return {
    name: 'supermarket-pos',
    productName: 'Supermarket POS',
    version: desktop.version,
    description: 'Supermarket POS, inventory and management system',
    author: desktop.author,
    main: 'desktop/main/main.js',
    dependencies: { ...pinned, ...desktop.dependencies },
  };
};

const copyApp = () => {
  for (const dir of ['backend', 'frontend', 'desktop']) rmSync(join(stage, dir), { recursive: true, force: true });
  cpSync(at('backend/dist'), join(stage, 'backend/dist'), { recursive: true });
  cpSync(at('backend/prisma/migrations'), join(stage, 'backend/prisma/migrations'), { recursive: true });
  cpSync(at('frontend/dist'), join(stage, 'frontend'), { recursive: true });
  cpSync(at('desktop/dist'), join(stage, 'desktop'), { recursive: true });
};

const installDependencies = () => {
  const electronVersion = readJson(at('desktop/node_modules/electron/package.json')).version;
  run('npm', ['install', '--omit=dev', '--no-audit', '--no-fund', '--package-lock=false'], stage);
  // Native modules (better-sqlite3) must match Electron's runtime, not the system Node.
  run('npx', ['--no-install', 'electron-rebuild', '-f', '-v', electronVersion, '-w', 'better-sqlite3', '-m', stage], at('desktop'));
};

/** The generated Prisma client lives next to the backend's dependencies; it is refreshed on every run. */
const copyPrismaClient = () => {
  const generated = at('backend/node_modules/.prisma');
  if (!existsSync(generated)) throw new Error('Prisma client not generated. Run "npm install" in backend first.');
  cpSync(generated, join(stage, 'node_modules/.prisma'), { recursive: true });
};

const stageApp = () => {
  mkdirSync(stage, { recursive: true });
  const next = JSON.stringify(manifest(), null, 2);
  const manifestFile = join(stage, 'package.json');
  const changed = !existsSync(manifestFile) || readFileSync(manifestFile, 'utf8') !== next;
  copyApp();
  writeFileSync(manifestFile, next);
  // node_modules is kept between runs and rebuilt only when the dependency list changes.
  if (changed || !existsSync(join(stage, 'node_modules'))) installDependencies();
  copyPrismaClient();
};

const launch = () => {
  const electron = createRequire(at('desktop/package.json'))('electron');
  const { ELECTRON_RUN_AS_NODE: _ignored, ...env } = process.env;
  spawn(electron, [stage], { stdio: 'inherit', env }).on('exit', (code) => process.exit(code ?? 0));
};

const packageInstaller = () => {
  if (process.platform !== 'win32') throw new Error('The Windows installer must be built on Windows (or the windows-latest CI runner).');
  rmSync(at('desktop/release'), { recursive: true, force: true });
  run('npx', ['--no-install', 'electron-builder', '--win', 'nsis', '--x64', '--config', 'packaging/electron-builder.config.cjs'], at('desktop'));
  const unpackedModules = at('desktop', 'release', 'win-unpacked', 'resources', 'app.asar.unpacked', 'node_modules');
  const requiredRuntimeFiles = [
    join(unpackedModules, '.prisma', 'client', 'default.js'),
    join(unpackedModules, '@prisma', 'client', 'runtime', 'client.js'),
  ];
  if (requiredRuntimeFiles.some((file) => !existsSync(file))) throw new Error('The packaged Prisma client or runtime is missing. Check the Electron Builder extraResources configuration.');
  console.log(`\nInstaller: ${at('desktop/release/Supermarket-POS-Setup.exe')}`);
};

if (!flags.has('--no-build')) build();
stageApp();
console.log(`\nDesktop app staged in ${stage}`);
if (flags.has('--run')) launch();
if (flags.has('--package')) packageInstaller();
