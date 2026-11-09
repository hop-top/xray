/**
 * Xray event payload definitions.
 *
 * ## Emission convention
 *
 * Every event in `XrayEvents` is emitted in one of two modes. The mode is
 * documented per event via an `@emission` JSDoc tag and MUST match the
 * corresponding call site in `src/lib/xray.ts`.
 *
 * - `emitAsync` → **sequential, attach-order**. Listeners run one after the
 *   other in the order they were registered. Safe for listeners that mutate
 *   shared state (graph, ranked nodes, node/edge attributes, payload fields).
 *   Use this mode whenever any plugin might legitimately write through the
 *   payload.
 *
 * - `emitAsyncParallel` → **observer-only**. Listeners run concurrently via
 *   `Promise.all` with no ordering guarantees. Listeners MUST NOT mutate the
 *   payload or any shared state — this mode is reserved for metrics, logging,
 *   telemetry, and other pure observers.
 *
 * Contributors: if you add a mutation plugin to an event currently tagged
 * `@emission parallel`, you MUST also switch its emission site to
 * `emitAsync` and update the tag here. Otherwise you will introduce a race.
 *
 * Listeners MUST NOT deep-log event payloads that carry graph / renderer
 * references — the structures are large and logging them is almost always a
 * mistake.
 */
import Graph from 'graphology';
import { Tag, Import } from '../parser/types';
import { RankedNode, EdgeAttributes } from '../../types/graph';
import { XrayConfig } from '../xray';
import type { MapRenderer } from '../renderer/map-renderer';
import type { ChunkedRenderer } from '../renderer/chunked-renderer';

export interface XrayEvents {
  // Lifecycle: Scan

  /** @emission parallel */
  'scan:start': {
    path: string;
    config: XrayConfig;
  };

  /** @emission sequential */
  'scan:file': {
    file: string;
    skip?: boolean;  // Set to true to skip this file
  };

  /** @emission parallel */
  'scan:complete': {
    files: string[];
  };

  // Lifecycle: Cache

  /** @emission parallel */
  'cache:check': {
    file: string;
    mtime: number;
  };

  /** @emission sequential */
  'cache:hit': {
    file: string;
    tags: Tag[];
    imports: Import[];
    // Listeners can modify cached data before use
  };

  /** @emission parallel */
  'cache:miss': {
    file: string;
  };

  /** @emission sequential */
  'cache:write': {
    file: string;
    tags: Tag[];
    imports: Import[];
    // Listeners can modify data before caching
  };

  // Lifecycle: Parse

  /** @emission sequential */
  'parse:before': {
    file: string;
    content: string;
    skip?: boolean;
    // Listeners can modify content before parsing
  };

  /** @emission sequential */
  'parse:after': {
    file: string;
    tags: Tag[];
    imports: Import[];
    // Listeners can transform parsed results
  };

  /** @emission sequential */
  'parse:error': {
    file: string;
    error: Error;
    recovered?: boolean;
  };

  // Lifecycle: Graph Building

  /** @emission sequential */
  'graph:add-file': {
    file: string;
    tags: Tag[];
    imports: Import[];
    skip?: boolean;
  };

  /** @emission sequential */
  'graph:add-node': {
    nodeId: string;
    attrs: any;
    skip?: boolean;
    // Listeners can modify node attributes
  };

  /** @emission sequential */
  'graph:add-edge': {
    source: string;
    target: string;
    type: 'defines' | 'calls' | 'imports';
    skip?: boolean;
    attrs?: EdgeAttributes;
  };

  /** @emission sequential */
  'graph:complete': {
    graph: Graph;
    nodeCount: number;
    edgeCount: number;
  };

  // Lifecycle: Ranking

  /** @emission parallel */
  'rank:start': {
    graph: Graph;
    anchor?: string;
  };

  /** @emission sequential */
  'rank:complete': {
    graph: Graph;
    rankedNodes: RankedNode[];
    // Listeners can re-order or modify rankings
  };

  // Lifecycle: Rendering

  /** @emission sequential */
  'render:start': {
    format: string;
    chunked: boolean;
    outputPath: string;
    renderer: MapRenderer | ChunkedRenderer;
  };

  /** @emission sequential */
  'render:chunk': {
    chunkPath: string;
    content: string;
    // Listeners can modify rendered content
  };

  /** @emission parallel */
  'render:complete': {
    outputPath: string;
    filesWritten: number;
  };

  // Special: Error handling

  /** @emission sequential */
  'error': {
    event: string;
    error: Error;
    payload: any;
    recovered?: boolean;
  };

  // Special: Progress

  /** @emission parallel */
  'progress': {
    stage: string;
    current: number;
    total: number;
    message: string;
  };

  // Command lifecycle events (for telemetry and other observers)

  /** @emission parallel */
  'command:start': {
    command: string;
    options: Record<string, any>;
    timestamp: number;
    traceId: string;
  };

  /** @emission parallel */
  'command:complete': {
    command: string;
    duration: number;
    success: boolean;
    timestamp: number;
    traceId: string;
  };

  /** @emission parallel */
  'command:error': {
    command: string;
    error: Error;
    errorType: string;
    timestamp: number;
    traceId: string;
    context?: Record<string, any>;
  };

  /** @emission parallel */
  'stat:recorded': {
    name: string;
    value: number;
    unit: string;
    context?: Record<string, any>;
    timestamp: number;
  };

  // Preset lifecycle — fired by `applyPreset` after every run.
  // Observers only; payload is informational and must not be mutated.

  /** @emission parallel */
  'preset:applied': {
    presetName: string;
    applied: string[];
    skipped: string[];
    errored: string[];
    timings: Record<string, number>;
  };
}
