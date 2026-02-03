/**
 * Analysis State - Immutable state for CQRS pattern
 *
 * Key features:
 * - Immutable state object
 * - Builder pattern for construction
 * - State transitions return new instances
 * - Serialization/deserialization support
 * - Deep equality checking
 *
 * Reference: IMPLEMENTATION_CONTEXT.md - "Immutable state (AnalysisState)"
 */

/**
 * State snapshot for serialization
 */
export interface StateSnapshot {
  graph: any | null;
  files: string[];
  metadata: Record<string, any>;
}

/**
 * Partial state update
 */
export interface PartialState {
  graph?: any | null;
  files?: string[];
  metadata?: Record<string, any>;
}

/**
 * AnalysisState is an immutable container for analysis results
 *
 * Commands mutate state by creating new instances.
 * Queries read state without modification.
 *
 * Usage:
 * ```typescript
 * // Create initial state
 * const state = new AnalysisState({ graph: null, files: [], metadata: {} });
 *
 * // Update state (returns new instance)
 * const newState = state.withFiles(['file1.ts', 'file2.ts']);
 *
 * // State is immutable
 * console.log(state.files);     // []
 * console.log(newState.files);  // ['file1.ts', 'file2.ts']
 * ```
 */
export class AnalysisState {
  private readonly _graph: any | null;
  private readonly _files: ReadonlyArray<string>;
  private readonly _metadata: Readonly<Record<string, any>>;

  constructor(snapshot: StateSnapshot) {
    // Create defensive copies to ensure immutability
    this._graph = snapshot.graph;
    this._files = Object.freeze([...snapshot.files]);
    this._metadata = Object.freeze({ ...snapshot.metadata });

    // Freeze the instance to prevent mutations
    Object.freeze(this);
  }

  /**
   * Get graph (immutable)
   */
  get graph(): any | null {
    return this._graph;
  }

  /**
   * Get files list (immutable)
   */
  get files(): ReadonlyArray<string> {
    return this._files;
  }

  /**
   * Get metadata (immutable)
   */
  get metadata(): Readonly<Record<string, any>> {
    return this._metadata;
  }

  /**
   * Create new state with updated graph
   */
  withGraph(graph: any | null): AnalysisState {
    return new AnalysisState({
      graph,
      files: [...this._files],
      metadata: { ...this._metadata },
    });
  }

  /**
   * Create new state with updated files
   */
  withFiles(files: string[]): AnalysisState {
    return new AnalysisState({
      graph: this._graph,
      files: [...files],
      metadata: { ...this._metadata },
    });
  }

  /**
   * Create new state with updated metadata
   */
  withMetadata(metadata: Record<string, any>): AnalysisState {
    return new AnalysisState({
      graph: this._graph,
      files: [...this._files],
      metadata: { ...metadata },
    });
  }

  /**
   * Create new state with partial updates
   */
  merge(partial: PartialState): AnalysisState {
    return new AnalysisState({
      graph: partial.graph !== undefined ? partial.graph : this._graph,
      files: partial.files !== undefined ? [...partial.files] : [...this._files],
      metadata: partial.metadata !== undefined ? { ...partial.metadata } : { ...this._metadata },
    });
  }

  /**
   * Convert state to plain object snapshot
   */
  toSnapshot(): StateSnapshot {
    return {
      graph: this._graph,
      files: [...this._files],
      metadata: { ...this._metadata },
    };
  }

  /**
   * Create state from snapshot
   */
  static fromSnapshot(snapshot: StateSnapshot): AnalysisState {
    return new AnalysisState(snapshot);
  }

  /**
   * Check deep equality with another state
   */
  equals(other: AnalysisState): boolean {
    // Compare graph (simple reference equality for now)
    if (this._graph !== other._graph) {
      return false;
    }

    // Compare files array
    if (this._files.length !== other._files.length) {
      return false;
    }

    for (let i = 0; i < this._files.length; i++) {
      if (this._files[i] !== other._files[i]) {
        return false;
      }
    }

    // Compare metadata
    const thisKeys = Object.keys(this._metadata);
    const otherKeys = Object.keys(other._metadata);

    if (thisKeys.length !== otherKeys.length) {
      return false;
    }

    for (const key of thisKeys) {
      if (this._metadata[key] !== other._metadata[key]) {
        return false;
      }
    }

    return true;
  }
}

/**
 * Builder for constructing AnalysisState incrementally
 *
 * Usage:
 * ```typescript
 * const state = new AnalysisStateBuilder()
 *   .setFiles(['file1.ts', 'file2.ts'])
 *   .setMetadata({ version: 1 })
 *   .build();
 * ```
 */
export class AnalysisStateBuilder {
  private graph: any | null = null;
  private files: string[] = [];
  private metadata: Record<string, any> = {};

  /**
   * Set graph
   */
  setGraph(graph: any | null): this {
    this.graph = graph;
    return this;
  }

  /**
   * Set files list
   */
  setFiles(files: string[]): this {
    this.files = [...files];
    return this;
  }

  /**
   * Set metadata
   */
  setMetadata(metadata: Record<string, any>): this {
    this.metadata = { ...metadata };
    return this;
  }

  /**
   * Build immutable state
   */
  build(): AnalysisState {
    return new AnalysisState({
      graph: this.graph,
      files: this.files,
      metadata: this.metadata,
    });
  }
}
