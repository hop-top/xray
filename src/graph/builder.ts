const Graph = require('graphology');
import { Tag, Import } from '../parser/types';

export class GraphBuilder {
  private graph: any;

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
          signature: tag.signature,
          doc: tag.doc
        });
      }
      // Edge: File defines Tag
      this.graph.addEdge(file, tagId, { type: 'defines' });
    }

    // Note: In a full implementation, we would resolve imports to files
    // and add edges: file -> imported_file
  }

  loadFromCache(file: string, tags: Tag[], imports: Import[]) {
    this.addFile(file, tags, imports);
  }

  getGraph(): any {
    return this.graph;
  }
}
