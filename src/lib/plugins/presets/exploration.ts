/**
 * createExplorationPreset — raw surprise signal, no grouping, no
 * human-readable questions.
 *
 * Skips clustering (no community attributes) and question-generator
 * (no insight block in the root chunk). Aimed at power users who want
 * to consume `xray.retrieve('surprise', n)` programmatically without
 * any of the opinionated narrative layers on top.
 */

import type { Preset } from './types';
import { ConfidenceEnricherPlugin } from '../confidence-enricher';
import { SurpriseAnalyzerPlugin } from '../surprise-analyzer';

export const createExplorationPreset: Preset = () => [
  new ConfidenceEnricherPlugin({ rules: [] }),
  new SurpriseAnalyzerPlugin(),
];
