// src/lib/strategy/infrastructure/parsers/terraform.ts
import { InfrastructureConfig, InfrastructureResource, InfrastructureTool } from '../types';

function extractBlock(content: string, startIndex: number): string {
  let braceCount = 1;
  let endIndex = startIndex;

  while (endIndex < content.length && braceCount > 0) {
    if (content[endIndex] === '{') braceCount++;
    if (content[endIndex] === '}') braceCount--;
    endIndex++;
  }

  return content.substring(startIndex, endIndex - 1);
}

export function parseTerraform(file: string, content: string): InfrastructureConfig {
  const resources: InfrastructureResource[] = [];
  const variables: Record<string, any> = {};
  const outputs: Record<string, any> = {};

  const cleaned = content
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '')
    .replace(/#.*$/gm, '');

  let match;
  const resourcePattern = /resource\s+"([^"]+)"\s+"([^"]+)"\s*\{/g;

  while ((match = resourcePattern.exec(cleaned)) !== null) {
    const [fullMatch, type, name] = match;
    const startIndex = match.index + fullMatch.length;
    const body = extractBlock(cleaned, startIndex);
    const properties = parseBlock(body);
    const dependencies = extractDependencies(body);

    resources.push({ type, name, properties, dependencies });
  }

  const moduleRegex = /module\s+"([^"]+)"\s*\{([^}]*(?:\{[^}]*\}[^}]*)*)\}/g;
  while ((match = moduleRegex.exec(cleaned)) !== null) {
    const [, name, body] = match;
    const properties = parseBlock(body);
    resources.push({ type: 'module', name, properties });
  }

  const providerRegex = /provider\s+"([^"]+)"\s*\{([^}]*(?:\{[^}]*\}[^}]*)*)\}/g;
  while ((match = providerRegex.exec(cleaned)) !== null) {
    const [, name, body] = match;
    const properties = parseBlock(body);
    resources.push({ type: 'provider', name, properties });
  }

  const dataRegex = /data\s+"([^"]+)"\s+"([^"]+)"\s*\{([^}]*(?:\{[^}]*\}[^}]*)*)\}/g;
  while ((match = dataRegex.exec(cleaned)) !== null) {
    const [, type, name, body] = match;
    const properties = parseBlock(body);
    resources.push({ type: `data.${type}`, name, properties });
  }

  const variableRegex = /variable\s+"([^"]+)"\s*\{([^}]*(?:\{[^}]*\}[^}]*)*)\}/g;
  while ((match = variableRegex.exec(cleaned)) !== null) {
    const [, name, body] = match;
    variables[name] = parseBlock(body);
  }

  const outputRegex = /output\s+"([^"]+)"\s*\{([^}]*(?:\{[^}]*\}[^}]*)*)\}/g;
  while ((match = outputRegex.exec(cleaned)) !== null) {
    const [, name, body] = match;
    outputs[name] = parseBlock(body);
  }

  const localsRegex = /locals\s*\{([^}]*(?:\{[^}]*\}[^}]*)*)\}/g;
  while ((match = localsRegex.exec(cleaned)) !== null) {
    const [, body] = match;
    const localVars = parseBlock(body);
    Object.assign(variables, localVars);
  }

  return {
    tool: 'terraform',
    resources,
    variables: Object.keys(variables).length > 0 ? variables : undefined,
    outputs: Object.keys(outputs).length > 0 ? outputs : undefined
  };
}

function parseBlock(block: string): Record<string, any> {
  const result: Record<string, any> = {};
  const lines = block.split('\n');
  let currentNestedBlock: string | null = null;
  let braceCount = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    // Track nested blocks
    const blockMatch = line.match(/^(\w+)\s*\{/);
    if (blockMatch && !currentNestedBlock) {
      const key = blockMatch[1];
      currentNestedBlock = key;
      result[key] = {};
      braceCount = 1;
      continue;
    }

    if (currentNestedBlock) {
      braceCount += (line.match(/\{/g) || []).length;
      braceCount -= (line.match(/\}/g) || []).length;
      if (braceCount === 0) {
        currentNestedBlock = null;
      }
      continue;
    }

    // Simple key = value
    const simpleMatch = line.match(/^(\w+)\s*=\s*(.+)$/);
    if (simpleMatch) {
      const [, key, value] = simpleMatch;
      result[key] = parseValue(value);
    }
  }

  return result;
}

function parseValue(value: string): any {
  value = value.trim();

  if (value.endsWith(',')) {
    value = value.slice(0, -1).trim();
  }

  if (value.startsWith('"') && value.endsWith('"')) {
    return value.slice(1, -1);
  }

  if (value === 'true') return true;
  if (value === 'false') return false;

  if (/^\d+$/.test(value)) {
    return parseInt(value, 10);
  }

  return value;
}

function extractDependencies(block: string): string[] {
  const dependencies: Set<string> = new Set();

  const dependsOnMatch = block.match(/depends_on\s*=\s*\[([^\]]+)\]/);
  if (dependsOnMatch) {
    const deps = dependsOnMatch[1].split(',').map(d => d.trim().replace(/["\s]/g, ''));
    deps.forEach(dep => dependencies.add(dep));
  }

  const refRegex = /(?:data\.)?(\w+)\.(\w+)\.(?:id|arn|name|\w+)/g;
  let match;
  while ((match = refRegex.exec(block)) !== null) {
    const [fullMatch, type, name] = match;
    if (fullMatch.startsWith('data.')) {
      dependencies.add(`data.${type}.${name}`);
    } else {
      dependencies.add(`${type}.${name}`);
    }
  }

  return Array.from(dependencies);
}

export const terraformTool: InfrastructureTool = {
  name: 'terraform',

  detect: (files: string[]): string[] | null => {
    const tfFiles = files.filter(f => f.endsWith('.tf'));
    return tfFiles.length > 0 ? tfFiles : null;
  },

  parse: parseTerraform
};
