/**
 * createInsightsPreset — the canonical "give me everything" bundle.
 *
 * Wires all four feature plugins in the spec-mandated order:
 *   1. ConfidenceEnricherPlugin — stamps confidence on every edge.
 *   2. ClusteringPlugin         — writes community attrs on graph:complete.
 *   3. SurpriseAnalyzerPlugin   — scores edges on rank:complete (depends on
 *                                 confidence + community).
 *   4. QuestionGeneratorPlugin  — produces insights on render:start
 *                                 (depends on surprise stash + community).
 *
 * Order matters because downstream plugins consume upstream side
 * effects via the shared graph and the `surprise` / `insights` stash
 * namespaces. The factory returns a fresh array on every call; plugin
 * state is per-run, never memoised.
 */

import type { Preset } from './types';
import { ConfidenceEnricherPlugin } from '../confidence-enricher';
import { ClusteringPlugin } from '../clustering';
import { SurpriseAnalyzerPlugin } from '../surprise-analyzer';
import { QuestionGeneratorPlugin } from '../question-generator';

export const createInsightsPreset: Preset = () => [
  new ConfidenceEnricherPlugin({ rules: [] }),
  new ClusteringPlugin(),
  new SurpriseAnalyzerPlugin(),
  new QuestionGeneratorPlugin(),
];
