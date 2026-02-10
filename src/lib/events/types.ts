import Graph from 'graphology';
import { Tag, Import } from '../parser/types';
import { RankedNode } from '../../types/graph';
import { XrayConfig } from '../xray';

export interface XrayEvents {
  // Lifecycle: Scan
  'scan:start': {
    path: string;
    config: XrayConfig;
  };

  'scan:file': {
    file: string;
    skip?: boolean;  // Set to true to skip this file
  };

  'scan:complete': {
    files: string[];
  };

  // Lifecycle: Cache
  'cache:check': {
    file: string;
    mtime: number;
  };

  'cache:hit': {
    file: string;
    tags: Tag[];
    imports: Import[];
    // Listeners can modify cached data before use
  };

  'cache:miss': {
    file: string;
  };

  'cache:write': {
    file: string;
    tags: Tag[];
    imports: Import[];
    // Listeners can modify data before caching
  };

  // Lifecycle: Parse
  'parse:before': {
    file: string;
    content: string;
    skip?: boolean;
    // Listeners can modify content before parsing
  };

  'parse:after': {
    file: string;
    tags: Tag[];
    imports: Import[];
    // Listeners can transform parsed results
  };

  'parse:error': {
    file: string;
    error: Error;
    recovered?: boolean;
  };

  // Lifecycle: Graph Building
  'graph:add-file': {
    file: string;
    tags: Tag[];
    imports: Import[];
    skip?: boolean;
  };

  'graph:add-node': {
    nodeId: string;
    attrs: any;
    skip?: boolean;
    // Listeners can modify node attributes
  };

  'graph:add-edge': {
    source: string;
    target: string;
    type: 'defines' | 'calls';
    skip?: boolean;
    attrs?: any;
  };

  'graph:complete': {
    graph: Graph;
    nodeCount: number;
    edgeCount: number;
  };

  // Lifecycle: Ranking
  'rank:start': {
    graph: Graph;
    anchor?: string;
  };

  'rank:complete': {
    rankedNodes: RankedNode[];
    // Listeners can re-order or modify rankings
  };

  // Lifecycle: Rendering
  'render:start': {
    format: string;
    chunked: boolean;
    outputPath: string;
  };

  'render:chunk': {
    chunkPath: string;
    content: string;
    // Listeners can modify rendered content
  };

  'render:complete': {
    outputPath: string;
    filesWritten: number;
  };

  // Special: Error handling
  'error': {
    event: string;
    error: Error;
    payload: any;
    recovered?: boolean;
  };

  // Special: Progress
  'progress': {
    stage: string;
    current: number;
    total: number;
    message: string;
  };

  // Command lifecycle events (for telemetry and other observers)
  'command:start': {
    command: string;
    options: Record<string, any>;
    timestamp: number;
    traceId: string;
  };

  'command:complete': {
    command: string;
    duration: number;
    success: boolean;
    timestamp: number;
    traceId: string;
  };

  'command:error': {
    command: string;
    error: Error;
    errorType: string;
    timestamp: number;
    traceId: string;
    context?: Record<string, any>;
  };

  'stat:recorded': {
    name: string;
    value: number;
    unit: string;
    context?: Record<string, any>;
    timestamp: number;
  };
}
