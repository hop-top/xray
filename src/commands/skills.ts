import * as path from 'path';
import { Command } from 'commander';
import { NotFoundError } from '../lib/error/types';
import {
  addOutputFlags,
  assertFormat,
  columns,
  emit,
  outputRegistry,
  textFormatter,
} from '../lib/output';
import { addResultFormat, assertResultFormat, emitResult } from '../lib/result-format';
import { SkillRegistry, type SkillMeta } from '../lib/skills/registry';
import { terminalSafe } from '../lib/terminal-safe';
import { declareEffect } from './side-effect';

interface SkillsCommandOptions {
  path?: string;
  config?: string;
  format?: string;
}

const skillsListRegistry = outputRegistry(
  textFormatter<SkillMeta[]>('text', (rows, put, s) => {
    if (rows.length === 0) {
      put('No skills found.');
      return;
    }
    for (const skill of rows) {
      const desc = skill.description ? ` — ${terminalSafe(skill.description)}` : '';
      put(`${s.bold(terminalSafe(skill.slug))} (${terminalSafe(skill.name)})${desc}`);
    }
  })
);

function resolveRoot(cmd: Command, opts: SkillsCommandOptions): { root: string; configPath?: string } {
  const globals = cmd.optsWithGlobals() as SkillsCommandOptions;
  const root = path.resolve(opts.path ?? process.cwd());
  return {
    root,
    configPath: globals.config ?? opts.config,
  };
}

export function registerSkillsCommand(program: Command): Command {
  const skills = program
    .command('skills')
    .description('Discover and inspect workspace skills');

  const listCmd = skills
    .command('list')
    .description('List available workspace skills')
    .option('-p, --path <dir>', 'Project root directory (defaults to current working directory)');
  declareEffect(listCmd, 'read', 'yes');
  addOutputFlags(listCmd, skillsListRegistry, {
    defaultFormat: 'text',
    description: 'Output format: text, json, yaml, table, csv',
  }).action(async (opts: SkillsCommandOptions, cmd: Command) => {
    assertFormat(cmd, skillsListRegistry);
    const { root, configPath } = resolveRoot(cmd, opts);
    const rows = new SkillRegistry(root, { configPath }).list();
    await emit(cmd, rows, {
      registry: skillsListRegistry,
      columns: columns('slug', 'name', 'description', 'triggers', 'path'),
      defaultFormat: 'text',
    });
  });

  const showCmd = addResultFormat(
    skills
      .command('show <slug>')
      .description('Show a workspace skill by slug')
      .option('-p, --path <dir>', 'Project root directory (defaults to current working directory)')
  ).action((slug: string, opts: SkillsCommandOptions, cmd: Command) => {
    assertResultFormat(cmd);
    const { root, configPath } = resolveRoot(cmd, opts);
    const skill = new SkillRegistry(root, { configPath }).read(slug);
    if (!skill) {
      throw new NotFoundError(`Skill not found: ${slug}`);
    }
    emitResult(cmd, skill, () => {
      process.stdout.write(skill.raw.endsWith('\n') ? skill.raw : skill.raw + '\n');
    });
  });
  declareEffect(showCmd, 'read', 'yes');

  return skills;
}
