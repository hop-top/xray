// src/lib/strategy/infrastructure/parsers/kubernetes.ts
import * as yaml from 'js-yaml';
import { InfrastructureConfig, InfrastructureResource, InfrastructureTool } from '../types';

export function parseKubernetes(file: string, content: string): InfrastructureConfig {
  const resources: InfrastructureResource[] = [];

  if (!content.trim()) {
    return { tool: 'kubernetes', resources };
  }

  try {
    const documents = yaml.loadAll(content) as any[];

    for (const doc of documents) {
      if (!doc || typeof doc !== 'object') continue;

      const kind = doc.kind;
      const name = doc.metadata?.name;

      if (!kind || !name) continue;

      const apiVersion = doc.apiVersion;
      const namespace = doc.metadata?.namespace;
      const properties: Record<string, any> = {
        apiVersion
      };

      if (namespace) {
        properties.namespace = namespace;
      }

      if (doc.spec) {
        if (doc.spec.replicas !== undefined) {
          properties.replicas = doc.spec.replicas;
        }
        if (doc.spec.storageClassName) {
          properties.storageClassName = doc.spec.storageClassName;
        }
        if (doc.spec.serviceName) {
          properties.serviceName = doc.spec.serviceName;
        }
      }

      if (doc.type) {
        properties.type = doc.type;
      }

      if (doc.data) {
        properties.data = doc.data;
      }

      const dependencies = extractKubernetesDependencies(doc);

      resources.push({
        type: kind,
        name,
        properties,
        dependencies: dependencies.length > 0 ? dependencies : undefined
      });
    }
  } catch (error) {
    // Ignore parse errors for non-Kubernetes YAML
  }

  return { tool: 'kubernetes', resources };
}

function extractKubernetesDependencies(doc: any): string[] {
  const dependencies: Set<string> = new Set();

  const spec = doc.spec;
  if (!spec) return [];

  if (spec.template?.spec?.containers) {
    for (const container of spec.template.spec.containers) {
      if (container.envFrom) {
        for (const envFrom of container.envFrom) {
          if (envFrom.configMapRef?.name) {
            dependencies.add(`ConfigMap/${envFrom.configMapRef.name}`);
          }
          if (envFrom.secretRef?.name) {
            dependencies.add(`Secret/${envFrom.secretRef.name}`);
          }
        }
      }
    }
  }

  return Array.from(dependencies);
}

export const kubernetesTool: InfrastructureTool = {
  name: 'kubernetes',

  detect: (files: string[]): string[] | null => {
    const yamlFiles = files.filter(f => f.endsWith('.yaml') || f.endsWith('.yml'));
    return yamlFiles.length > 0 ? yamlFiles : null;
  },

  parse: parseKubernetes
};
