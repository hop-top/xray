import * as path from 'path';
import type { Command } from 'commander';
import { generateHandbook } from '../lib/handbook/generator';
import { addResultFormat, assertResultFormat, emitResult } from '../lib/result-format';
import { Logger } from '../lib/logger';
import { declareEffect, emitPlan, previewing } from './side-effect';

export interface HandbookCommandOptions {
  path?: string;
  output?: string;
  config?: string;
  confirm?: string | boolean;
  format?: string;
}

export function registerHandbookCommand(program: Command): Command {
  const cmd = addResultFormat(
    program
      .command('handbook')
      .description('Generate deterministic architectural handbook pages (.xray/handbook/)')
      .argument('[path]', 'Project root directory (defaults to current working directory)')
      .option('-p, --path <dir>', 'Project root directory')
      .option('-o, --output <dir>', 'Output directory (defaults to .xray/handbook)')
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
          detail: 'Generate deterministic architectural handbook markdown files',
        },
      ]);
      return;
    }

    const confirmRaw = globals.confirm ?? opts.confirm;
    const confirm = confirmRaw === true || String(confirmRaw).toLowerCase() === 'yes';

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
