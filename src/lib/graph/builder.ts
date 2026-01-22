const Graph = require('graphology');
import { Tag, Import } from '../parser/types';

export class GraphBuilder {
  private graph: any;
  private pendingReferences: Map<string, { tagId: string, references: string[] }> = new Map();

  constructor() {
    this.graph = new Graph({ multi: true, type: 'directed' });
  }

  addFile(file: string, tags: Tag[], imports: Import[]) {
    // Add File Node
    if (!this.graph.hasNode(file)) {
      this.graph.addNode(file, { type: 'file', label: file });
    }

    // Add Tag Nodes and Edges
    for (const tag of tags) {
      const tagId = `${file}::${tag.name}`;
      if (!this.graph.hasNode(tagId)) {
        this.graph.addNode(tagId, {
          type: 'tag',
          label: tag.name,
          kind: tag.kind,
          file: file,
          line: tag.line,
          endLine: tag.endLine,
          signature: tag.signature,
          doc: tag.doc
        });
      }
      // Edge: File defines Tag
      this.graph.addEdge(file, tagId, { type: 'defines' });

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

  getGraph(): any {
    // Build reference edges before returning graph
    this.buildReferenceEdges();
    return this.graph;
  }

  private buildReferenceEdges() {
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
          for (const targetTagId of targetTags) {
            // Avoid self-references
            if (targetTagId !== tagId) {
              // Only add edge if it doesn't already exist
              if (!this.graph.hasEdge(tagId, targetTagId)) {
                this.graph.addEdge(tagId, targetTagId, { type: 'calls' });
              }
            }
          }
        }
      }
    }
  }
}
