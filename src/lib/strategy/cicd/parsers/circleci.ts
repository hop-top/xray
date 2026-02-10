// src/lib/strategy/cicd/parsers/circleci.ts
import * as yaml from 'js-yaml';
import { CICDPlatform, CICDConfig, Workflow, Job } from '../types';

/**
 * Parse CircleCI configuration file
 */
export function parseCircleCI(file: string, content: string): CICDConfig {
  const doc = yaml.load(content) as any;
  const jobs: Job[] = [];

  // Parse jobs
  for (const [name, jobDef] of Object.entries(doc.jobs || {})) {
    const job = jobDef as any;

    // Determine executor (docker, machine, etc.)
    let runsOn = 'unknown';
    if (job.docker && job.docker[0]?.image) {
      runsOn = job.docker[0].image;
    } else if (job.machine?.image) {
      runsOn = job.machine.image;
    } else if (job.executor) {
      // Handle executor reference
      if (typeof job.executor === 'string') {
        // Look up executor in executors section
        if (doc.executors && doc.executors[job.executor]) {
          const executor = doc.executors[job.executor];
          if (executor.docker && executor.docker[0]?.image) {
            runsOn = executor.docker[0].image;
          }
        }
      }
    }

    // Parse steps
    const steps = (job.steps || []).map((step: any) => {
      // Handle string steps (like 'checkout' or commands)
      if (typeof step === 'string') {
        if (step === 'checkout') {
          return { name: 'Checkout code', uses: 'checkout' };
        }
        return { run: step };
      }

      // Handle run steps
      if (step.run) {
        const runStep: any = {
          name: typeof step.run === 'object' ? step.run.name : undefined,
          run: typeof step.run === 'object' ? (step.run.command || step.run) : step.run
        };
        // Remove undefined name if not present
        if (runStep.name === undefined) {
          delete runStep.name;
        }
        return runStep;
      }

      // Handle checkout as object (though rare)
      if (step.checkout !== undefined) {
        return { name: 'Checkout code', uses: 'checkout' };
      }

      // Keep other step types as-is (store_artifacts, etc.)
      return step;
    });

    jobs.push({
      name,
      runsOn,
      dependsOn: [], // Will be populated from workflow
      steps
    });
  }

  // Get workflow name (exclude 'version' key)
  const workflowNames = Object.keys(doc.workflows || {}).filter(k => k !== 'version');
  const workflowName = workflowNames.length > 0 ? workflowNames[0] : 'default';

  const workflow: Workflow = {
    name: workflowName,
    file,
    triggers: [{ type: 'push' }], // Simplified
    jobs
  };

  // Update job dependencies from workflow
  if (doc.workflows) {
    for (const workflowDef of Object.values(doc.workflows)) {
      const wf = workflowDef as any;
      if (wf.jobs) {
        wf.jobs.forEach((jobRef: any) => {
          if (typeof jobRef === 'object') {
            const jobName = Object.keys(jobRef)[0];
            const jobConfig = jobRef[jobName];
            if (jobConfig && jobConfig.requires) {
              const job = jobs.find(j => j.name === jobName);
              if (job) {
                job.dependsOn = jobConfig.requires;
              }
            }
          }
        });
      }
    }
  }

  return {
    platform: 'circleci',
    workflows: [workflow]
  };
}

/**
 * CircleCI platform definition
 */
export const circleCIPlatform: CICDPlatform = {
  name: 'circleci',
  detect: (files) => files.includes('.circleci/config.yml') ? ['.circleci/config.yml'] : null,
  parse: parseCircleCI
};
