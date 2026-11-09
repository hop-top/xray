// src/lib/strategy/build/parsers/makefile.ts
import { BuildConfig, BuildTarget, BuildTool } from '../types';

/**
 * Parse a Makefile into a unified BuildConfig
 */
export function parseMakefile(file: string, content: string): BuildConfig {
  const targets: BuildTarget[] = [];
  const dependencies: Record<string, string[]> = {};
  const phonyTargets = new Set<string>();

  const lines = content.split('\n');
  let currentTarget: BuildTarget | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Skip empty lines
    if (line.trim() === '') {
      continue;
    }

    // Skip comments
    if (line.trim().startsWith('#')) {
      continue;
    }

    // Handle .PHONY declaration
    if (line.startsWith('.PHONY:')) {
      const phonyNames = line.substring('.PHONY:'.length).trim().split(/\s+/);
      phonyNames.forEach(name => phonyTargets.add(name));
      continue;
    }

    // Check for target line: "target: dep1 dep2"
    // Target lines start at column 0 (no leading whitespace) and contain a colon
    if (!line.startsWith('\t') && !line.startsWith(' ') && line.includes(':')) {
      const colonIndex = line.indexOf(':');
      const beforeColon = line.substring(0, colonIndex);

      // Skip variable assignments (contain =)
      if (beforeColon.includes('=')) {
        continue;
      }

      const name = beforeColon.trim();
      const afterColon = line.substring(colonIndex + 1).trim();
      const deps = afterColon ? afterColon.split(/\s+/).filter(Boolean) : [];

      currentTarget = {
        name,
        dependencies: deps,
        recipe: [],
        phony: phonyTargets.has(name)
      };

      targets.push(currentTarget);
      dependencies[name] = deps;
    }
    // Recipe line: starts with tab
    else if (line.startsWith('\t') && currentTarget) {
      currentTarget.recipe.push(line.substring(1));
    }
  }

  return {
    tool: 'make',
    targets,
    defaultTarget: targets.length > 0 ? targets[0].name : undefined,
    dependencies
  };
}

/**
 * Make build tool implementation
 */
export const makeTool: BuildTool = {
  name: 'make',

  detect: (files: string[]): string | null => {
    return files.find(f =>
      f === 'Makefile' ||
      f === 'makefile' ||
      f.endsWith('.mk')
    ) || null;
  },

  parse: parseMakefile
};
