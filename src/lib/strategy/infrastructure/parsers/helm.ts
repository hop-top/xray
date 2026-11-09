// src/lib/strategy/infrastructure/parsers/helm.ts
import * as yaml from 'js-yaml';
import { InfrastructureConfig, InfrastructureResource, InfrastructureTool } from '../types';

export function parseHelm(file: string, content: string): InfrastructureConfig {
  const resources: InfrastructureResource[] = [];
  let variables: Record<string, any> = {};
  const outputs: Record<string, any> = {};

  if (!content.trim()) {
    return { tool: 'helm', resources, variables };
  }

  const fileName = file.split('/').pop() || file;

  try {
    if (fileName === 'Chart.yaml') {
      const chart = yaml.load(content) as any;

      if (!chart) {
        return { tool: 'helm', resources };
      }

      const properties: Record<string, any> = {
        version: chart.version,
        apiVersion: chart.apiVersion
      };

      if (chart.appVersion) {
        properties.appVersion = chart.appVersion;
      }
      if (chart.description) {
        properties.description = chart.description;
      }
      if (chart.type) {
        properties.type = chart.type;
      }
      if (chart.maintainers) {
        properties.maintainers = chart.maintainers;
      }
      if (chart.keywords) {
        properties.keywords = chart.keywords;
      }

      const dependencies: string[] = [];
      if (chart.dependencies) {
        for (const dep of chart.dependencies) {
          dependencies.push(`${dep.name}@${dep.version}`);
        }
      }

      resources.push({
        type: 'helm-chart',
        name: chart.name,
        properties,
        dependencies: dependencies.length > 0 ? dependencies : undefined
      });

      if (chart.version) {
        outputs.chartVersion = chart.version;
      }
      if (chart.appVersion) {
        outputs.appVersion = chart.appVersion;
      }

      return {
        tool: 'helm',
        resources,
        outputs: Object.keys(outputs).length > 0 ? outputs : undefined,
        dependencies: dependencies.length > 0 ? { [chart.name]: dependencies } : undefined
      };
    } else if (fileName === 'values.yaml' || fileName.startsWith('values')) {
      variables = yaml.load(content) as any || {};

      return {
        tool: 'helm',
        resources: [],
        variables
      };
    }
  } catch (error) {
    throw new Error(`Failed to parse Helm file: ${error}`);
  }

  return { tool: 'helm', resources };
}

export const helmTool: InfrastructureTool = {
  name: 'helm',

  detect: (files: string[]): string[] | null => {
    const helmFiles = files.filter(f => {
      const basename = f.split('/').pop() || f;
      return basename === 'Chart.yaml' || basename === 'values.yaml' || basename.startsWith('values');
    });
    return helmFiles.length > 0 ? helmFiles : null;
  },

  parse: parseHelm
};
