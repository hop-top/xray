// src/lib/strategy/infrastructure/parsers/cloudformation.ts
import * as yaml from 'js-yaml';
import { InfrastructureConfig, InfrastructureResource, InfrastructureTool } from '../types';

// CloudFormation custom YAML tag schema
const cfnSchema = yaml.DEFAULT_SCHEMA.extend([
  new yaml.Type('!Ref', {
    kind: 'scalar',
    construct: (data) => ({ Ref: data })
  }),
  new yaml.Type('!GetAtt', {
    kind: 'sequence',
    construct: (data) => ({ 'Fn::GetAtt': data })
  }),
  new yaml.Type('!GetAtt', {
    kind: 'scalar',
    construct: (data) => {
      const parts = data.split('.');
      return { 'Fn::GetAtt': parts };
    }
  }),
  new yaml.Type('!Sub', {
    kind: 'scalar',
    construct: (data) => ({ 'Fn::Sub': data })
  }),
  new yaml.Type('!Join', {
    kind: 'sequence',
    construct: (data) => ({ 'Fn::Join': data })
  }),
  new yaml.Type('!Equals', {
    kind: 'sequence',
    construct: (data) => ({ 'Fn::Equals': data })
  }),
  new yaml.Type('!And', {
    kind: 'sequence',
    construct: (data) => ({ 'Fn::And': data })
  }),
  new yaml.Type('!Not', {
    kind: 'sequence',
    construct: (data) => ({ 'Fn::Not': data })
  }),
  new yaml.Type('!FindInMap', {
    kind: 'sequence',
    construct: (data) => ({ 'Fn::FindInMap': data })
  })
]);

export function parseCloudFormation(file: string, content: string): InfrastructureConfig {
  const resources: InfrastructureResource[] = [];
  let variables: Record<string, any> = {};
  const outputs: Record<string, any> = {};

  if (!content.trim()) {
    return { tool: 'cloudformation', resources };
  }

  let template: any;

  try {
    if (file.endsWith('.json')) {
      template = JSON.parse(content);
    } else {
      template = yaml.load(content, { schema: cfnSchema }) as any;
    }
  } catch (error) {
    return { tool: 'cloudformation', resources };
  }

  if (!template || typeof template !== 'object') {
    return { tool: 'cloudformation', resources };
  }

  if (template.Parameters) {
    variables = template.Parameters;
  }

  if (template.Mappings) {
    variables.Mappings = template.Mappings;
  }

  if (template.Outputs) {
    for (const [name, output] of Object.entries(template.Outputs as Record<string, any>)) {
      outputs[name] = output;
    }
  }

  if (template.Resources) {
    for (const [name, resource] of Object.entries(template.Resources as Record<string, any>)) {
      const type = resource.Type;
      const properties = resource.Properties || {};
      const metadata = resource.Metadata;
      const condition = resource.Condition;

      const deps = extractCloudFormationDependencies(resource, name);

      const resourceObj: InfrastructureResource = {
        type,
        name,
        properties: { ...properties }
      };

      if (condition) {
        resourceObj.properties!.Condition = condition;
      }

      if (metadata) {
        resourceObj.metadata = metadata;
      }

      if (deps.length > 0) {
        resourceObj.dependencies = deps;
      }

      resources.push(resourceObj);
    }
  }

  return {
    tool: 'cloudformation',
    resources,
    variables: Object.keys(variables).length > 0 ? variables : undefined,
    outputs: Object.keys(outputs).length > 0 ? outputs : undefined
  };
}

function extractCloudFormationDependencies(resource: any, currentName: string): string[] {
  const dependencies: Set<string> = new Set();

  if (resource.DependsOn) {
    if (Array.isArray(resource.DependsOn)) {
      resource.DependsOn.forEach((dep: string) => dependencies.add(dep));
    } else {
      dependencies.add(resource.DependsOn);
    }
  }

  function traverse(obj: any) {
    if (!obj || typeof obj !== 'object') return;

    if (obj.Ref && typeof obj.Ref === 'string') {
      const ref = obj.Ref;
      if (ref !== currentName && !ref.startsWith('AWS::')) {
        dependencies.add(ref);
      }
    }

    if (obj['Fn::GetAtt']) {
      const getAtt = obj['Fn::GetAtt'];
      if (Array.isArray(getAtt) && getAtt.length > 0) {
        const ref = getAtt[0];
        if (ref !== currentName) {
          dependencies.add(ref);
        }
      }
    }

    if (obj.RestApiId && typeof obj.RestApiId === 'object' && obj.RestApiId.Ref) {
      dependencies.add(obj.RestApiId.Ref);
    }

    for (const key in obj) {
      if (typeof obj[key] === 'object') {
        traverse(obj[key]);
      }
    }
  }

  traverse(resource);

  return Array.from(dependencies);
}

export const cloudFormationTool: InfrastructureTool = {
  name: 'cloudformation',

  detect: (files: string[]): string[] | null => {
    const cfFiles = files.filter(f => {
      const lower = f.toLowerCase();
      return (
        lower.includes('template') ||
        lower.includes('cloudformation') ||
        lower.includes('sam.') ||
        lower.endsWith('.template.json') ||
        lower.endsWith('.template.yaml') ||
        lower.endsWith('.template.yml')
      );
    });
    return cfFiles.length > 0 ? cfFiles : null;
  },

  parse: parseCloudFormation
};
