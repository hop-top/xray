import * as path from 'path';
import type { Command } from 'commander';
import { DEFAULT_MAX_STEPS, runAskLoop } from '../lib/agent/ask-loop';
import { Logger } from '../lib/logger';
import { addResultFormat, assertResultFormat, emitResult } from '../lib/result-format';
import { declareEffect } from './side-effect';

export interface AskCommandOptions {
  path?: string;
  maxSteps?: string | number;
  out?: string;
  config?: string;
  offline?: boolean;
  format?: string;
}

export function registerAskCommand(program: Command): Command {
  const cmd = addResultFormat(
    program
      .command('ask')
      .description('Ask a question about the codebase using read-only xray tools and BYOK LLM')
      .argument('<question>', 'Question to answer about the codebase')
      .option('-p, --path <dir>', 'Project root directory (defaults to current working directory)')
      .option('--max-steps <n>', `Maximum tool-loop steps (default ${DEFAULT_MAX_STEPS})`, String(DEFAULT_MAX_STEPS))
      .option('--out <file>', 'Write shareable markdown transcript to <file>')
  ).action(async (question: string, opts: AskCommandOptions, command: Command) => {
    assertResultFormat(command);
    const globals = command.optsWithGlobals() as AskCommandOptions;
    const root = path.resolve(opts.path ?? process.cwd());
    const maxSteps = opts.maxSteps !== undefined ? Number(opts.maxSteps) : DEFAULT_MAX_STEPS;

    const result = await runAskLoop({
      root,
      question,
      maxSteps,
      outFile: opts.out,
      offline: Boolean(globals.offline ?? opts.offline),
      configPath: globals.config ?? opts.config,
    });

    emitResult(command, result, () => {
      process.stdout.write(result.answer + '\n');
      if (result.outFile) {
        Logger.success(`Saved transcript to ${result.outFile}`);
      }
    });
  });

  return declareEffect(cmd, 'read', 'no');
}
