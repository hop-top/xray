// src/lib/strategy/build/parsers/justfile.ts
import { BuildConfig, BuildTarget, BuildTool } from '../types';

/**
 * Parse a Justfile into a unified BuildConfig
 */
export function parseJustfile(file: string, content: string): BuildConfig {
  const targets: BuildTarget[] = [];
  const lines = content.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Check for recipe line: "name: deps..." or "name param: deps..."
    // Recipes start at column 0 and contain a colon
    const trimmedLine = line.trim();
    if (trimmedLine && !line.startsWith(' ') && !line.startsWith('\t') && line.includes(':')) {
      // Extract recipe name and dependencies
      const colonIndex = line.indexOf(':');
      const beforeColon = line.substring(0, colonIndex).trim();
      const afterColon = line.substring(colonIndex + 1).trim();

      // Recipe name may have parameters: "build target" -> "build"
      const nameParts = beforeColon.split(/\s+/);
      const name = nameParts[0];

      // Dependencies are after the colon
      const deps = afterColon ? afterColon.split(/\s+/).filter(Boolean) : [];

      // Check for description comment on previous line
      let description: string | undefined;
      if (i > 0 && lines[i - 1].trim().startsWith('#')) {
        description = lines[i - 1].trim().substring(1).trim();
      }

      // Collect recipe lines (indented with spaces or tabs)
      const recipe: string[] = [];
      for (let j = i + 1; j < lines.length; j++) {
        const recipeLine = lines[j];
        if (recipeLine.startsWith('  ') || recipeLine.startsWith('\t')) {
          recipe.push(recipeLine.trim());
        } else if (recipeLine.trim() === '') {
          // Skip empty lines within recipe
          continue;
        } else {
          // End of recipe (non-indented line)
          break;
        }
      }

      targets.push({
        name,
        description,
        dependencies: deps,
        recipe
      });
    }
  }

  return {
    tool: 'just',
    targets,
    defaultTarget: targets.length > 0 ? targets[0].name : undefined,
    dependencies: Object.fromEntries(
      targets.map(t => [t.name, t.dependencies])
    )
  };
}

/**
 * Just build tool implementation
 */
export const justTool: BuildTool = {
  name: 'just',

  detect: (files: string[]): string | null => {
    return files.find(f =>
      f === 'Justfile' ||
      f === 'justfile' ||
      f === '.justfile'
    ) || null;
  },

  parse: parseJustfile
};
