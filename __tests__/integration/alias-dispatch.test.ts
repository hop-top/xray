import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const CLI_PATH = path.join(__dirname, '../../bin/cli.js');

describe('alias dispatch matches target command', () => {
  let root: string;
  let home: string;

  beforeAll(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'alias-dispatch-'));
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'alias-dispatch-home-'));
    fs.writeFileSync(
      path.join(root, 'package.json'),
      JSON.stringify({ name: 'p', dependencies: { react: '^18.2.0', 'react-dom': '^18.2.0' } })
    );
    fs.mkdirSync(path.join(root, 'src'));
    fs.writeFileSync(
      path.join(root, 'src/Button.tsx'),
      'import React from "react";\nexport function Button() { return <button />; }\n'
    );
    fs.writeFileSync(
      path.join(root, '.xrayrc.json'),
      JSON.stringify({ aliases: { rc: 'react components' } })
    );
  });

  afterAll(() => {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(home, { recursive: true, force: true });
  });

  const run = (...args: string[]) =>
    spawnSync('node', [CLI_PATH, ...args], {
      cwd: root,
      env: { ...process.env, HOME: home, NO_COLOR: '1' },
      encoding: 'utf8',
    });

  it('alias finds the same components as the target', () => {
    const target = run('react', 'components');
    const alias = run('rc');
    expect(target.stdout).toContain('Button');
    expect(alias.status).toBe(0);
    expect(alias.stdout).toContain('Button');
    expect(alias.stdout).not.toContain('(none found)');
    expect(alias.stdout.trim()).toBe(target.stdout.trim());
  });

  it('alias honours --path', () => {
    const alias = run('rc', '--path', root);
    expect(alias.stdout).toContain('Button');
  });
});
