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

    // Add Tag Nodes and Edges
    for (const tag of tags) {
      const tagId = `${file}::${tag.name}`;
      if (!this.graph.hasNode(tagId)) {
        const nodeEvent = {
          nodeId: tagId,
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
        };

        await this.emitAsync('node:add', nodeEvent);

        if (!nodeEvent.skip) {
          this.graph.addNode(tagId, nodeEvent.attrs);
        }
      }

      // Edge: File defines Tag
      if (this.graph.hasNode(file) && this.graph.hasNode(tagId)) {
        const edgeEvent = { source: file, target: tagId, type: 'defines' as const, attrs: { type: 'defines' }, skip: false };
        await this.emitAsync('edge:add', edgeEvent);

        if (!edgeEvent.skip) {
          this.graph.addEdge(file, tagId, edgeEvent.attrs);
        }
      }

      // Store references for later edge creation
      if (tag.references && tag.references.length > 0) {
        this.pendingReferences.set(tagId, { tagId, references: tag.references });
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

    // For each tag with references, create edges to matching tags
    for (const { tagId, references } of this.pendingReferences.values()) {
      for (const refName of references) {
        const targetTags = tagNameMap.get(refName);
        if (targetTags) {
          // Event: Reference resolution (listeners can modify targets)
          const resolveEvent = { sourceTag: tagId, targetName: refName, resolved: [...targetTags] };
          await this.emitAsync('reference:resolve', resolveEvent);

          for (const targetTagId of resolveEvent.resolved) {
            // Avoid self-references
            if (targetTagId !== tagId) {
              // Only add edge if it doesn't already exist
              if (!this.graph.hasEdge(tagId, targetTagId)) {
                const edgeEvent = { source: tagId, target: targetTagId, type: 'calls' as const, attrs: { type: 'calls' }, skip: false };
                await this.emitAsync('edge:add', edgeEvent);

                if (!edgeEvent.skip) {
                  this.graph.addEdge(tagId, targetTagId, edgeEvent.attrs);
                }
              }
            }
          }
        }
      }
    }
  }
}
