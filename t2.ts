#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Command definitions & Help
const commands = {
  'apply': 'apply patch',
  'bench': 'benchmark system',
  'bootstrap': 'bootstrap vital deps on homebrew systems',
  'config|conf': 'creates a target configuration profile',
  'inst|install': 'installs a package and its dependencies',
  'uninstall': 'uninstalls a package from the system',
  'download|dl': 'downloads assets of a package',
  'build-target': 'builds a whole target sandbox',
  'clean|clear': 'clean-up build artifacts',
  'create': 'create a package from external URLs',
  'create-iso': 'create an ISO after a target build',
  'list-errors': 'list build target errors',
  'commit': 'commit changes to the T2 source tree',
  'find': 'find package based on meta data',
  'update': 'update a package meta-data version',
  'upgrade': 'upgrade the system install packages',
  'up|pull|sync': 'update / pull t2 source tree changes',
  'help': 'show help for a sub-command',
  'info': 'show information about currently installed packages',
};

// 1. Root check & re-exec
if (process.getuid && process.getuid() !== 0) {
  console.log('t2 requires root privileges');
  const res = spawnSync('su', ['root', process.argv[1], ...process.argv.slice(2)], {
    stdio: 'inherit',
  });
  process.exit(res.status ?? 1);
}

// 2. Resolve root directory
const filename = fileURLToPath(import.meta.url);
const scriptDir = path.dirname(fs.realpathSync(filename));
if (!fs.existsSync('t2') && scriptDir) {
  try {
    process.chdir(scriptDir);
  } catch (err) {
    console.error(`Failed to change directory to ${scriptDir}:`, err.message);
  }
}

function usage() {
  console.log('Usage: t2 command <options>\nCommands:');

  const sortedKeys = Object.keys(commands).sort();
  for (const key of sortedKeys) {
    const desc = commands[key];
    const n = key.length + 2;
    const tab = n > 7 ? '\t' : '\t\t';
    console.log(`  ${key}${tab}${desc}`);
  }

  console.log('Options:\n  -v, --verbose\tverbose operation\n  -c, --cfg\tconfig name');
  process.exit(1);
}

// 4. Command & Argument Parsing
let cmd = '';
const args = [];
const rawArgs = process.argv.slice(2);

for (let a of rawArgs) {
  // Convert modern --* args to backward-compat single-dash -*
  if (a.startsWith('--')) {
    a = a.replace(/^--/, '-');
  }

  const isOption = a.startsWith('-');
  const prevArg = args[args.length - 1];

  if (!cmd && !isOption && (!args.length || prevArg !== '-cfg')) {
    cmd = a;
    continue;
  }
  args.push(a);
}

// Transform `t2 help <command>` -> `t2 <command> -help`
if (cmd === 'help') {
  if (args[0]) {
    cmd = args[0];
  }
  args.length = 0;
  args.push('-help');
}

// 5. Helpers
function commandExists(bin) {
  const res = spawnSync('which', [bin], { stdio: 'ignore' });
  return res.status === 0;
}

function execChecked(scriptPath, extraArgs = []) {
  if (!fs.existsSync(scriptPath)) {
    console.log('Error: t2 not fully checked out: run "t2 up" to initialize or update.');
    process.exit(1);
  }
  const result = spawnSync(scriptPath, [...extraArgs, ...args], { stdio: 'inherit' });
  process.exit(result.status ?? 0);
}

// 6. Command Dispatcher
switch (cmd) {
  case 'apply':
    execChecked('scripts/Apply');
    break;
  case 'conf':
  case 'config':
    execChecked('scripts/Config');
    break;
  case 'bench':
    execChecked('scripts/Bench');
    break;
  case 'bootstrap':
    execChecked('scripts/Bootstrap');
    break;
  case 'build-target':
    execChecked('scripts/Build-Target');
    break;
  case 'clean':
  case 'clear':
    execChecked('scripts/Cleanup');
    break;
  case 'create':
    execChecked('scripts/Create-Pkg');
    break;
  case 'create-iso':
    execChecked('scripts/Create-ISO');
    break;
  case 'list-errors':
    execChecked('scripts/Create-ErrList');
    break;
  case 'commit':
  case 'ci':
    execChecked('scripts/Commit');
    break;
  case 'download':
  case 'dl':
    execChecked('scripts/Download');
    break;
  case 'find':
    execChecked('scripts/Find-Pkg');
    break;
  case 'install':
  case 'inst':
    execChecked('scripts/Emerge-Pkg');
    break;
  case 'update':
    execChecked('scripts/Update-Pkg');
    break;
  case 'update-system':
  case 'upgrade':
    execChecked('scripts/Emerge-Pkg', ['-system']);
    break;

  case 'uninstall': {
    if (args[0] === '-help') {
      console.log('Usage: <package>');
      process.exit(0);
    }
    const pm = commandExists('mine') ? 'mine' : 'bize';
    const res = spawnSync(pm, ['-r', ...args], { stdio: 'inherit' });
    process.exit(res.status ?? 0);
  }

  case 'up':
  case 'pull':
  case 'sync': {
    if (args[0] === '-help') {
      console.log('Usage: [ files ]');
      process.exit(0);
    }
    const isGit = fs.existsSync('.git');
    const res = isGit
      ? spawnSync('git', ['pull'], { stdio: 'inherit' })
      : spawnSync('svn', ['up', ...args], { stdio: 'inherit' });
    process.exit(res.status ?? 0);
  }

  case 'info': {
    const validSubcommands = {
      checksum: '-m',
      depends: '-d',
      details: '-p',
      files: '-l',
      version: '-q',
    };

    if (args.length <= 1 || !validSubcommands[args[0]]) {
      console.log('Usage: t2 info <checksum|depends|details|files|version> <package1> [package2] ...');
      process.exit(args.length <= 1 ? 0 : 1);
    }

    const mineCmd = validSubcommands[args[0]];
    const pm = commandExists('mine') ? 'mine' : 'bize';
    const res = spawnSync(pm, [mineCmd, ...args.slice(1)], { stdio: 'inherit' });
    process.exit(res.status ?? 0);
  }

  default:
    usage();
}
