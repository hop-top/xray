// src/lib/strategy/cicd/parsers/github-actions.ts
import * as yaml from 'js-yaml';
import * as path from 'path';
import { CICDPlatform, CICDConfig, Workflow, Job, Trigger } from '../types';

/**
 * Parse GitHub Actions workflow file
 */
export function parseGitHubActions(file: string, content: string): CICDConfig {
  const doc = yaml.load(content) as any;

  const workflow: Workflow = {
    name: doc.name || path.basename(file, path.extname(file)),
    file,
    triggers: parseTriggers(doc.on),
    jobs: parseJobs(doc.jobs || {})
  };

  return {
    platform: 'github-actions',
    workflows: [workflow]
  };
}

/**
 * Parse trigger configuration from 'on' field
 */
function parseTriggers(on: any): Trigger[] {
  const triggers: Trigger[] = [];

  if (!on) {
    return triggers;
  }

  if (typeof on === 'string') {
    triggers.push({ type: on as any });
  } else if (Array.isArray(on)) {
    on.forEach(event => triggers.push({ type: event }));
  } else if (typeof on === 'object') {
    for (const [event, config] of Object.entries(on)) {
      const trigger: Trigger = { type: event as any };

      if (config && typeof config === 'object') {
        if ((config as any).branches) {
          trigger.branches = (config as any).branches;
        }
        if ((config as any).tags) {
          trigger.tags = (config as any).tags;
        }
        if ((config as any).paths) {
          trigger.paths = (config as any).paths;
        }
      }

      triggers.push(trigger);
    }
  }

  return triggers;
}

/**
 * Parse jobs from workflow
 */
function parseJobs(jobs: any): Job[] {
  const result: Job[] = [];

  for (const [jobName, jobDef] of Object.entries(jobs)) {
    const job = jobDef as any;

    result.push({
      name: jobName,
      runsOn: job['runs-on'] || 'unknown',
      dependsOn: job.needs ? (Array.isArray(job.needs) ? job.needs : [job.needs]) : [],
      steps: (job.steps || []).map((step: any) => ({
        name: step.name,
        uses: step.uses,
        run: step.run,
        with: step.with
      })),
      condition: job.if,
      environment: typeof job.environment === 'string' ? job.environment : job.environment?.name
    });
  }

  return result;
}

/**
 * GitHub Actions platform definition
 */
export const githubActionsPlatform: CICDPlatform = {
  name: 'github-actions',
  detect: (files) => {
    const detected = files.filter(f =>
      f.startsWith('.github/workflows/') &&
      (f.endsWith('.yml') || f.endsWith('.yaml'))
    );
    return detected.length > 0 ? detected : null;
  },
  parse: parseGitHubActions
};
