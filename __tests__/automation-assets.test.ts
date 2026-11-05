import { execFileSync, spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as yaml from 'js-yaml';

const ROOT = path.resolve(__dirname, '..');
const PKG = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).name as string;

interface Step { name?: string; id?: string; if?: string; run?: string }
interface Action { inputs: Record<string, { default?: string }>; runs: { steps: Step[] } }

const action = yaml.load(fs.readFileSync(path.join(ROOT, 'action.yaml'), 'utf8')) as Action;
const step = (name: string): Step => {
  const s = action.runs.steps.find(x => x.name === name);
  if (!s) throw new Error(`action.yaml: no step named "${name}"`);
  return s;
};

describe('action.yaml', () => {
  test('installs the published package name, not the unrelated "xray" package', () => {
    const run = step('Install xray').run ?? '';
    expect(run).toContain(`npm install -g ${PKG}@`);
    expect(run).not.toMatch(/npm install -g xray\b/);
  });

  test('commits whenever regeneration changed files, regardless of skip-if-no-changes', () => {
    const cond = step('Commit and push changes').if ?? '';
    expect(cond).toContain("steps.regenerate.outputs.changes_detected == 'true'");
    expect(cond).not.toContain('skip-if-no-changes');
  });

  test('skip-if-no-changes only decides no-op vs failure when nothing changed', () => {
    const s = step('Fail when nothing changed');
    expect(s.if).toContain("steps.regenerate.outputs.changes_detected == 'false'");
    expect(s.if).toContain("inputs.skip-if-no-changes != 'true'");
    expect(s.run).toMatch(/exit 1/);
    expect(action.inputs['skip-if-no-changes'].default).toBe('true');
  });

  test('every input is documented in docs/user/automation.md and vice versa', () => {
    const doc = fs.readFileSync(path.join(ROOT, 'docs/user/automation.md'), 'utf8');
    const section = doc.slice(doc.indexOf('### Inputs'), doc.indexOf('### Advanced Examples'));
    const documented = [...section.matchAll(/^\| `([a-z-]+)` \|/gm)].map(m => m[1]).sort();
    expect(documented).toEqual(Object.keys(action.inputs).sort());
  });
});

describe('hooks/pre-commit', () => {
  const HOOK = path.join(ROOT, 'hooks/pre-commit');
  // the hook declares bash (NUL-safe path handling needs it)
  const SH = '/bin/bash';
  let repo: string;
  let bin: string;

  // isolate from the developer's global git config (excludesFile, hooks, signing)
  const gitEnv = () => ({ HOME: repo, XDG_CONFIG_HOME: repo, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' });
  const git = (...args: string[]) =>
    execFileSync('git', args, { cwd: repo, stdio: 'pipe', env: { ...process.env, ...gitEnv() } });
  const runHook = (pathEnv: string) =>
    spawnSync(SH, [HOOK], { cwd: repo, encoding: 'utf8', env: { PATH: pathEnv, ...gitEnv() } });
  const sysPath = ['/usr/bin', '/bin', path.dirname(execFileSync('which', ['git']).toString().trim())].join(':');

  beforeEach(() => {
    repo = fs.mkdtempSync(path.join(os.tmpdir(), 'xray-precommit-'));
    bin = path.join(repo, '.fakebin');
    fs.mkdirSync(bin);
    git('init', '-q');
    git('config', 'user.email', 't@example.com');
    git('config', 'user.name', 't');
    fs.writeFileSync(path.join(repo, '.xrayrc.json'), '{}\n');
    fs.writeFileSync(path.join(repo, 'a.ts'), 'export const a = 1;\n');
    // config is read from the index, so it has to be staged (or tracked)
    git('add', '.xrayrc.json', 'a.ts');
  });

  afterEach(() => fs.rmSync(repo, { recursive: true, force: true }));

  test('declares the shell it needs', () => {
    expect(fs.readFileSync(HOOK, 'utf8').split('\n')[0]).toBe('#!/usr/bin/env bash');
  });

  test('runs xray when it is on PATH', () => {
    const log = path.join(repo, 'xray-calls.log');
    fs.writeFileSync(path.join(bin, 'xray'), `#!/bin/sh\necho "$@" >> "${log}"\n`, { mode: 0o755 });
    const r = runHook(`${bin}:${sysPath}`);
    expect(r.status).toBe(0);
    expect(r.stdout).not.toContain('not installed');
    expect(fs.readFileSync(log, 'utf8')).toMatch(/^map/m);
  });

  test('when xray is missing, points at the published package name', () => {
    const r = runHook(sysPath);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('not installed');
    expect(r.stdout).toContain(`npm install -g ${PKG}`);
  });
});
