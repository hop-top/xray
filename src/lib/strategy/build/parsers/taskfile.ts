// src/lib/strategy/build/parsers/taskfile.ts
import * as yaml from 'js-yaml';
import { BuildConfig, BuildTarget, BuildTool } from '../types';

/**
 * Parse a Taskfile (YAML) into a unified BuildConfig
 */
export function parseTaskfile(file: string, content: string): BuildConfig {
  const doc = yaml.load(content) as any;
  const targets: BuildTarget[] = [];

  if (!doc || !doc.tasks) {
    return {
      tool: 'task',
      targets: [],
      defaultTarget: undefined,
      dependencies: {}
    };
  }

  for (const [name, taskDef] of Object.entries(doc.tasks)) {
    const task = taskDef as any;

    // Extract description (prefer 'desc' over 'description')
    const description = task.desc || task.description;

    // Extract dependencies
    const dependencies = task.deps || [];

    // Extract commands
    let recipe: string[] = [];
    if (task.cmds) {
      if (Array.isArray(task.cmds)) {
        recipe = task.cmds.map((c: any) => {
          if (typeof c === 'string') {
            return c;
          } else if (c && typeof c === 'object' && c.cmd) {
            return c.cmd;
          }
          return '';
        }).filter(Boolean);
      }
    } else if (task.cmd) {
      recipe = [task.cmd];
    }

    targets.push({
      name,
      description,
      dependencies,
      recipe
    });
  }

  return {
    tool: 'task',
    targets,
    defaultTarget: doc.default,
    dependencies: Object.fromEntries(
      targets.map(t => [t.name, t.dependencies])
    )
  };
}

/**
 * Task build tool implementation
 */
export const taskTool: BuildTool = {
  name: 'task',

  detect: (files: string[]): string | null => {
    return files.find(f =>
      f === 'Taskfile.yml' ||
      f === 'Taskfile.yaml'
    ) || null;
  },

  parse: parseTaskfile
};
