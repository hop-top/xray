// src/lib/strategy/build/parsers/npm-scripts.ts
import { BuildConfig, BuildTarget, BuildTool } from '../types';

/**
 * Parse package.json scripts into a unified BuildConfig
 */
export function parsePackageJson(file: string, content: string): BuildConfig {
  const pkg = JSON.parse(content);
  const scripts = pkg.scripts || {};
  const targets: BuildTarget[] = [];

  for (const [name, script] of Object.entries(scripts)) {
    const scriptStr = script as string;
    const deps: string[] = [];

    // Remove quoted strings and comments to avoid false positives
    // This is a simple heuristic - remove anything in double/single quotes
    let cleanedScript = scriptStr;
    // Remove double-quoted strings
    cleanedScript = cleanedScript.replace(/"[^"]*"/g, '');
    // Remove single-quoted strings
    cleanedScript = cleanedScript.replace(/'[^']*'/g, '');
    // Remove comments (everything after #)
    cleanedScript = cleanedScript.replace(/#.*$/, '');

    // Detect script dependencies by matching patterns like:
    // - npm run other-script
    // - yarn other-script
    // - pnpm run other-script
    const patterns = [
      /\b(?:npm|pnpm)\s+run\s+([a-z0-9:-]+)/g,
      /\byarn\s+([a-z0-9:-]+)/g
    ];

    for (const pattern of patterns) {
      const matches = cleanedScript.matchAll(pattern);
      for (const match of matches) {
        const depName = match[1];
        // Only add if it's not already in the list
        if (!deps.includes(depName)) {
          deps.push(depName);
        }
      }
    }

    targets.push({
      name,
      dependencies: deps,
      recipe: [scriptStr]
    });
  }

  return {
    tool: 'npm',
    targets,
    defaultTarget: scripts.start ? 'start' : undefined,
    dependencies: Object.fromEntries(
      targets.map(t => [t.name, t.dependencies])
    )
  };
}

/**
 * npm scripts build tool implementation
 */
export const npmScriptsTool: BuildTool = {
  name: 'npm',

  detect: (files: string[]): string | null => {
    return files.find(f => f === 'package.json') || null;
  },

  parse: parsePackageJson
};
