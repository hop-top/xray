// src/lib/strategy/cicd/parsers/gitlab-ci.ts
import * as yaml from 'js-yaml';
import { CICDPlatform, CICDConfig, Workflow, Job, Trigger } from '../types';

/**
 * Parse GitLab CI configuration file
 */
export function parseGitLabCI(file: string, content: string): CICDConfig {
  const doc = yaml.load(content) as any;
  const jobs: Job[] = [];

  // GitLab CI jobs are top-level keys (except special ones)
  const specialKeys = ['stages', 'workflow', 'variables', 'default', 'include'];

  for (const [name, jobDef] of Object.entries(doc)) {
    // Skip special keys and hidden jobs (starting with .)
    if (specialKeys.includes(name) || name.startsWith('.')) {
      continue;
    }

    const job = jobDef as any;

    // Parse script commands into steps
    const steps: any[] = [];

    // Add before_script steps
    if (job.before_script) {
      const beforeScripts = Array.isArray(job.before_script) ? job.before_script : [job.before_script];
      beforeScripts.forEach((cmd: string) => steps.push({ run: cmd }));
    }

    // Add script steps
    if (job.script) {
      const scripts = Array.isArray(job.script) ? job.script : [job.script];
      scripts.forEach((cmd: string) => steps.push({ run: cmd }));
    }

    // Add after_script steps
    if (job.after_script) {
      const afterScripts = Array.isArray(job.after_script) ? job.after_script : [job.after_script];
      afterScripts.forEach((cmd: string) => steps.push({ run: cmd }));
    }

    jobs.push({
      name,
      runsOn: job.image || 'default',
      dependsOn: job.needs || [],
      steps,
      condition: job.rules ? 'conditional' : undefined,
      environment: typeof job.environment === 'string' ? job.environment : job.environment?.name
    });
  }

  const workflow: Workflow = {
    name: 'GitLab CI',
    file,
    triggers: parseGitLabTriggers(doc),
    jobs
  };

  return {
    platform: 'gitlab-ci',
    workflows: [workflow]
  };
}

/**
 * Parse GitLab CI triggers from workflow rules
 */
function parseGitLabTriggers(doc: any): Trigger[] {
  const triggers: Trigger[] = [];

  // GitLab uses 'rules' and 'only/except'
  if (doc.workflow?.rules) {
    // Parse complex rules - simplified for now
    triggers.push({ type: 'push' });
  } else {
    // Default: run on push
    triggers.push({ type: 'push' });
  }

  return triggers;
}

/**
 * GitLab CI platform definition
 */
export const gitlabCIPlatform: CICDPlatform = {
  name: 'gitlab-ci',
  detect: (files) => files.includes('.gitlab-ci.yml') ? ['.gitlab-ci.yml'] : null,
  parse: parseGitLabCI
};
