/**
 * Control- and data-flow graphs of one function (intra-procedural).
 *
 * Both are plain JSON: they ride on a tag's `cfg` / `dfg` fields through the
 * parse cache, the serialized graph and the renderers. Lines are 0-based like
 * every other line in the graph.
 */

/**
 * - entry / exit: one each per function; exit is always `n1`
 * - stmt: a statement or declaration; expr: an operand evaluated on one branch
 * - cond: a test (`if`, `?:`, one operand of `&&` `||` `??`); loop: a loop test or head
 * - switch: the discriminant; case: one `case` test (`default` has no node)
 * - return / throw / break / continue: the jump statement itself
 * - catch: entry of a `catch` clause
 * - rethrow: where an exception leaves a `finally` copy (always `throw`-labelled out)
 */
export type CfgKind =
  | 'entry' | 'exit' | 'stmt' | 'expr' | 'cond' | 'loop' | 'switch' | 'case'
  | 'return' | 'throw' | 'break' | 'continue' | 'catch' | 'rethrow';

export type CfgEdgeLabel = 'true' | 'false' | 'throw';

export interface CfgNode {
  id: string;
  kind: CfgKind;
  /** Source text of the node, whitespace collapsed, capped. */
  label: string;
  line: number;
  /** Callee texts evaluated by this node (`new Foo` for constructors). */
  calls?: string[];
}

export interface CfgEdge {
  from: string;
  to: string;
  /** Absent: ordinary successor. */
  label?: CfgEdgeLabel;
}

/** Set when a function is larger than the node cap: the graph is a prefix. */
export interface FlowTruncation {
  /** Nodes the full graph has. */
  nodes: number;
  /** Nodes kept. */
  limit: number;
}

export interface Cfg {
  nodes: CfgNode[];
  edges: CfgEdge[];
  truncated?: FlowTruncation;
  /** Functions defined inside this one, each with its own graph. */
  closures?: Array<Cfg & { name: string; line: number }>;
}

/**
 * param: formal parameter (defined at entry); decl: declaration; assign: `=`;
 * update: `++`, `--`, `+=` ...; loop: `for-in/of` variable; catch: catch
 * parameter; function / class: declaration binding; member: `o.p = v` (weak:
 * may change `o`, kills nothing); maybe: `||=` `&&=` `??=` (weak).
 */
export type DefKind =
  | 'param' | 'decl' | 'assign' | 'update' | 'loop' | 'catch' | 'function' | 'class'
  | 'member' | 'maybe';

export interface DfgDef {
  id: string;
  name: string;
  kind: DefKind;
  line: number;
  /** CFG node the definition happens at. */
  at: string;
  /** Referenced by a nested function: its reads and writes there are not tracked. */
  captured?: true;
  /** Does not kill earlier definitions of the same variable. */
  weak?: true;
}

export interface DfgEdge {
  /** Definition (`DfgDef.id`) ... */
  from: string;
  /** ... reaching a use in this CFG node. */
  to: string;
}

/** A CFG node a definition reaches (self-contained when only `df` is on). */
export interface DfgSite {
  id: string;
  line: number;
  label: string;
}

export interface Dfg {
  nodes: DfgDef[];
  edges: DfgEdge[];
  sites: DfgSite[];
  truncated?: FlowTruncation;
  closures?: Array<Dfg & { name: string; line: number }>;
}

export interface FlowResult {
  cfg?: Cfg;
  dfg?: Dfg;
}

/** Most CFG nodes kept per function (nested functions count separately). */
export const MAX_FLOW_NODES = 500;
