/**
 * `react components|hooks|contexts`: every component in a file is listed, and
 * an empty result says why instead of printing a bare empty list.
 */
import { StrategyContextImpl } from '../../src/lib/strategy/context';
import { Logger } from '../../src/lib/logger';
import ReactStrategy from '../../strategies/react';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { globSync } from 'glob';

const strategy = new ReactStrategy();
let root: string;

function write(rel: string, text: string): void {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, text);
}

/** Mirror what the CLI does before a strategy command: analyze, tag, store metadata. */
async function analyzed(): Promise<StrategyContextImpl> {
  const ctx = new StrategyContextImpl(root);
  const ignore = strategy.ignorePatterns();
  for (const ext of strategy.fileTypes()) {
    for (const file of globSync(`**/*${ext}`, { cwd: root, nodir: true, ignore })) {
      const meta = await strategy.analyze(path.join(root, file), ctx);
      for (const tag of meta.tags) ctx.addFileTag(file, tag);
      if (meta.metadata && Object.keys(meta.metadata).length) ctx.setFileMetadata(file, 'react', meta.metadata);
    }
  }
  return ctx;
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'xray-react-cmd-'));
  write('package.json', '{"name":"p","dependencies":{"react":"18.0.0"}}');
});
afterEach(() => {
  jest.restoreAllMocks();
  fs.rmSync(root, { recursive: true, force: true });
});

describe('react components', () => {
  it('lists every component of a file: function, arrow and class', async () => {
    write('src/Button.tsx', [
      "import React from 'react';",
      'export function Button(props: { label: string }) { return <button>{props.label}</button>; }',
      'export const Arrow = () => <div/>;',
      'export class Klass extends React.Component { render() { return <span/>; } }',
    ].join('\n'));
    const got = await strategy.commands.components.handler(await analyzed());
    expect(got.map((c: any) => [c.name, c.type]).sort()).toEqual([
      ['Arrow', 'function'], ['Button', 'function'], ['Klass', 'class'],
    ]);
    expect(new Set(got.map((c: any) => c.file))).toEqual(new Set(['src/Button.tsx']));
  });

  it('keeps componentName / componentType as the first component', async () => {
    write('src/Two.tsx', 'export const A = () => <i/>;\nexport const B = () => <b/>;\n');
    const ctx = await analyzed();
    expect(ctx.getMetadata('src/Two.tsx', 'react')).toMatchObject({ componentName: 'A', componentType: 'function' });
  });

  it('explains an empty result when the only components are in test paths', async () => {
    write('__tests__/fixtures/app/Button.tsx', 'export function Button() { return <button/>; }\n');
    write('src/Card.test.tsx', 'export function Card() { return <i/>; }\n');
    const warn = jest.spyOn(Logger, 'warn').mockImplementation(() => undefined);
    const got = await strategy.commands.components.handler(await analyzed());
    expect(got).toEqual([]);
    expect(warn).toHaveBeenCalledTimes(1);
    const msg = String(warn.mock.calls[0][0]);
    expect(msg).toMatch(/no React components/i);
    expect(msg).toMatch(/2 .*(test|__tests__)/i);
  });

  it('explains an empty result when no .jsx/.tsx file exists', async () => {
    write('src/a.ts', 'export const a = 1;\n');
    const warn = jest.spyOn(Logger, 'warn').mockImplementation(() => undefined);
    expect(await strategy.commands.components.handler(await analyzed())).toEqual([]);
    expect(String(warn.mock.calls[0][0])).toMatch(/no \.jsx\/\.tsx files/i);
  });

  it('does not warn when components are found', async () => {
    write('src/Ok.tsx', 'export function Ok() { return <b/>; }\n');
    const warn = jest.spyOn(Logger, 'warn').mockImplementation(() => undefined);
    expect((await strategy.commands.components.handler(await analyzed())).length).toBe(1);
    expect(warn).not.toHaveBeenCalled();
  });
});

describe('react hooks / contexts', () => {
  it('say why when nothing is found', async () => {
    write('src/a.ts', 'export const a = 1;\n');
    const warn = jest.spyOn(Logger, 'warn').mockImplementation(() => undefined);
    expect(await strategy.commands.hooks.handler(await analyzed())).toEqual([]);
    expect(await strategy.commands.contexts.handler(await analyzed())).toEqual([]);
    expect(warn).toHaveBeenCalledTimes(2);
    expect(String(warn.mock.calls[0][0])).toMatch(/no React hooks/i);
    expect(String(warn.mock.calls[1][0])).toMatch(/no React contexts/i);
  });
});
