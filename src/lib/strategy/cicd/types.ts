// src/lib/strategy/cicd/types.ts

/**
 * Trigger types for CI/CD workflows
 */
export type TriggerType =
  | 'push'
  | 'pull_request'
  | 'tag'
  | 'schedule'
  | 'manual'
  | 'workflow_dispatch';

/**
 * Trigger configuration
 */
export interface Trigger {
  type: TriggerType;
  branches?: string[];
  tags?: string[];
  paths?: string[];
}

/**
 * Workflow step (action or command)
 */
export interface Step {
  name?: string;
  uses?: string;
  run?: string;
  with?: Record<string, any>;
}

/**
 * CI/CD job
 */
export interface Job {
  name: string;
  runsOn: string;
  dependsOn: string[];
  steps: Step[];
  condition?: string;
  environment?: string;
}

/**
 * CI/CD workflow
 */
export interface Workflow {
  name: string;
  file: string;
  triggers: Trigger[];
  jobs: Job[];
  schedule?: string;
}

/**
 * Complete CI/CD configuration
 */
export interface CICDConfig {
  platform: string;
  workflows: Workflow[];
}

/**
 * CI/CD platform parser interface
 */
export interface CICDPlatform {
  name: string;
  detect: (files: string[]) => string[] | null;
  parse: (file: string, content: string) => CICDConfig;
}
