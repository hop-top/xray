import * as path from 'path';
import type { Command } from 'commander';
import { UsageError } from '../lib/error/types';
import { generateHandbook } from '../lib/handbook/generator';
import { runHandbookLlmPipeline } from '../lib/handbook/llm-pipeline';
import { addResultFormat, assertResultFormat, emitResult } from '../lib/result-format';
import { Logger } from '../lib/logger';
import { declareEffect, emitPlan, previewing } from './side-effect';

export interface HandbookCommandOptions {
  path?: string;
  output?: string;
  config?: string;
  confirm?: string | boolean;
  format?: string;
  llm?: boolean;
  delta?: boolean;
  maxTokens?: number;
  maxCost?: number;
  offline?: boolean;
}

export function registerHandbookCommand(program: Command): Command {
  const cmd = addResultFormat(
    program
      .command('handbook')
      .description('Generate deterministic architectural handbook pages (.xray/handbook/)')
      .argument('[path]', 'Project root directory (defaults to current working directory)')
      .option('-p, --path <dir>', 'Project root directory')
      .option('-o, --output <dir>', 'Output directory (defaults to .xray/handbook)')
      .option('--llm', 'Enrich handbook pages using optional 3-stage BYOK LLM pipeline')
      .option('--delta', 'With --llm, only re-survey subsystems with git changes since lastUpdatedCommit')
      .option('--max-tokens <n>', 'Maximum total token budget for --llm runs', Number)
      .option('--max-cost <usd>', 'Maximum USD cost budget for --llm runs', Number)
  ).action(async (argPath: string | undefined, opts: HandbookCommandOptions, command: Command) => {
    assertResultFormat(command);
    const globals = command.optsWithGlobals() as HandbookCommandOptions;
    const root = path.resolve(argPath ?? opts.path ?? process.cwd());
    const outputDir = path.resolve(root, opts.output ?? path.join('.xray', 'handbook'));

    if (previewing(command)) {
      emitPlan(command, [
        {
          kind: 'write',
          target: outputDir,
          reversible: true,
          detail: opts.llm
            ? 'Generate and LLM-enrich architectural handbook markdown files'
            : 'Generate deterministic architectural handbook markdown files',
        },
      ]);
      return;
    }

    const confirmRaw = globals.confirm ?? opts.confirm;
    const confirm = confirmRaw === true || String(confirmRaw).toLowerCase() === 'yes';

    if (opts.delta && !opts.llm) {
      throw new UsageError('--delta requires --llm');
    }

    if (opts.llm) {
      const result = await runHandbookLlmPipeline({
        root,
        outputDir,
        confirm,
        configPath: globals.config ?? opts.config,
        offline: Boolean(globals.offline ?? opts.offline),
        delta: Boolean(opts.delta),
        maxTokens: opts.maxTokens,
        maxCost: opts.maxCost,
      });

      emitResult(command, result, () => {
        if (result.budgetStopped) {
          Logger.warn(
            `Handbook LLM pipeline stopped early (${result.stoppedReason}); wrote ${result.files.length} file(s), spent ${result.totalTokens} tokens ($${result.totalCostUsd.toFixed(6)})`
          );
        } else {
          Logger.success(
            `Enriched ${result.files.length} handbook file(s) across ${result.subsystems} subsystem(s) in ${result.outputDir} (${result.totalTokens} tokens, $${result.totalCostUsd.toFixed(6)})`
          );
        }
      });
      return;
    }

    const result = await generateHandbook({
      root,
      outputDir,
      confirm,
      configPath: globals.config ?? opts.config,
    });

    emitResult(command, result, () => {
      Logger.success(
        `Generated ${result.files.length} handbook file(s) across ${result.subsystems} subsystem(s) in ${result.outputDir}`
      );
    });
  });

  return declareEffect(cmd, 'write-local', 'yes');
}
