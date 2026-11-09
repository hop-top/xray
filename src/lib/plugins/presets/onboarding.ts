/**
 * createOnboardingPreset — onboarding bundle, no surprise analyzer.
 *
 * Deliberately skips `SurpriseAnalyzerPlugin`: newcomers benefit from
 * structural clustering and human-readable questions, but raw surprise
 * scoring adds noise before the user has a mental model of the repo.
 *
 * The question-generator plugin degrades gracefully when no surprises
 * are stashed — its templates fall through to community / centrality
 * based questions. Covered by the degradation test shipped under
 * `question-generator-init` and re-asserted by US-0004 here.
 */

import type { Preset } from './types';
import { ConfidenceEnricherPlugin } from '../confidence-enricher';
import { ClusteringPlugin } from '../clustering';
import { QuestionGeneratorPlugin } from '../question-generator';

export const createOnboardingPreset: Preset = () => [
  new ConfidenceEnricherPlugin({ rules: [] }),
  new ClusteringPlugin(),
  new QuestionGeneratorPlugin(),
];
