const Graph = require('graphology');
import { Tag, Import } from '../parser/types';
import { AsyncEventEmitter } from '../events/async-emitter';

interface GraphBuilderEvents {
  'node:add': {
    nodeId: string;
    attrs: any;
    skip?: boolean;
  };

  'edge:add': {
    source: string;
    target: string;
    type: 'defines' | 'calls';
    attrs?: any;
    skip?: boolean;
  };

  'reference:resolve': {
    sourceTag: string;
    targetName: string;
    resolved: string[];
  };

  'error': {
    event: string;
    error: Error;
    payload: any;
  };
}

export class GraphBuilder extends AsyncEventEmitter<GraphBuilderEvents> {
  private graph: any;
  private pendingReferences: Map<string, { tagId: string, references: string[] }> = new Map();

  constructor() {
    super();
    this.graph = new Graph({ multi: true, type: 'directed' });
  }

  async addFile(file: string, tags: Tag[], imports: Import[]) {
    // Add File Node
    if (!this.graph.hasNode(file)) {
      const nodeEvent = { nodeId: file, attrs: { type: 'file', label: file }, skip: false };
      await this.emitAsync('node:add', nodeEvent);

      if (!nodeEvent.skip) {
        this.graph.addNode(file, nodeEvent.attrs);
      }
    }

    // Collect all node events first
    const nodeEvents: Array<{ nodeId: string, attrs: any, skip: boolean, tagId: string }> = [];
    const edgeEvents: Array<{ source: string, target: string, type: 'defines', attrs: any, skip: boolean }> = [];

    for (const tag of tags) {
      const tagId = `${file}::${tag.name}`;
      if (!this.graph.hasNode(tagId)) {
        nodeEvents.push({
          nodeId: tagId,
          tagId,
          attrs: {
            type: 'tag',
            label: tag.name,
            kind: tag.kind,
            file: file,
            line: tag.line,
            endLine: tag.endLine,
            signature: tag.signature,
            doc: tag.doc
          },
          skip: false
        });
      }

      // Store references for later edge creation
      if (tag.references && tag.references.length > 0) {
        this.pendingReferences.set(tagId, { tagId, references: tag.references });
      }
    }

    // Emit all node events in parallel
    if (nodeEvents.length > 0) {
      await Promise.all(nodeEvents.map(event =>
        this.emitAsync('node:add', event)
      ));

      // Add nodes that weren't skipped
      for (const event of nodeEvents) {
        if (!event.skip) {
          this.graph.addNode(event.nodeId, event.attrs);
        }
      }
    }

    // Now collect edge events for tags that were added
    for (const event of nodeEvents) {
      if (!event.skip && this.graph.hasNode(file) && this.graph.hasNode(event.tagId)) {
        edgeEvents.push({
          source: file,
          target: event.tagId,
          type: 'defines',
          attrs: { type: 'defines' },
          skip: false
        });
      }
    }

    // Emit all edge events in parallel
    if (edgeEvents.length > 0) {
      await Promise.all(edgeEvents.map(event =>
        this.emitAsync('edge:add', event)
      ));

      // Add edges that weren't skipped
      for (const event of edgeEvents) {
        if (!event.skip) {
          this.graph.addEdge(event.source, event.target, event.attrs);
        }
      }
    }

    // Note: In a full implementation, we would resolve imports to files
    // and add edges: file -> imported_file

    // Store imports as an attribute on the file node
    if (imports && imports.length > 0) {
      // Store full import objects
      this.graph.mergeNodeAttributes(file, { imports: imports });
    }
  }

  loadFromCache(file: string, tags: Tag[], imports: Import[]) {
    this.addFile(file, tags, imports);
  }

  async getGraph(): Promise<any> {
    // Build reference edges before returning graph
    await this.buildReferenceEdges();
    return this.graph;
  }

  private async buildReferenceEdges() {
    // Create a map of tag names to tag IDs for efficient lookups
    const tagNameMap = new Map<string, string[]>();
    this.graph.forEachNode((nodeId: string, attrs: any) => {
      if (attrs.type === 'tag') {
        const tagName = attrs.label;
        if (!tagNameMap.has(tagName)) {
          tagNameMap.set(tagName, []);
        }
        tagNameMap.get(tagName)!.push(nodeId);
      }
    });

    // Collect all reference resolution events first
    const resolveEvents: Array<{ sourceTag: string, targetName: string, resolved: string[] }> = [];

    for (const { tagId, references } of this.pendingReferences.values()) {
      for (const refName of references) {
        const targetTags = tagNameMap.get(refName);
        if (targetTags) {
          // Event: Reference resolution (listeners can modify targets)
          resolveEvents.push({
            sourceTag: tagId,
            targetName: refName,
            resolved: [...targetTags]
          });
        }
      }
    }

    // Emit all reference resolution events in parallel
    if (resolveEvents.length > 0) {
      await Promise.all(resolveEvents.map(event =>
        this.emitAsync('reference:resolve', event)
      ));
    }

    // Now collect all edge events based on resolved references
    const edgeEvents: Array<{ source: string, target: string, type: 'calls', attrs: any, skip: boolean }> = [];

    for (const resolveEvent of resolveEvents) {
      for (const targetTagId of resolveEvent.resolved) {
        // Avoid self-references
        if (targetTagId !== resolveEvent.sourceTag) {
          // Only add edge if it doesn't already exist
          if (!this.graph.hasEdge(resolveEvent.sourceTag, targetTagId)) {
            edgeEvents.push({
              source: resolveEvent.sourceTag,
              target: targetTagId,
              type: 'calls',
              attrs: { type: 'calls' },
              skip: false
            });
          }
        }
      }
    }

    // Emit all edge events in parallel
    if (edgeEvents.length > 0) {
      await Promise.all(edgeEvents.map(event =>
        this.emitAsync('edge:add', event)
      ));

      // Add edges that weren't skipped
      for (const event of edgeEvents) {
        if (!event.skip) {
          this.graph.addEdge(event.source, event.target, event.attrs);
        }
      }
    }
  }
}
