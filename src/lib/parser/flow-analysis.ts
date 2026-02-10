
import Parser from 'tree-sitter';
import { Logger } from '../logger';

export interface CFGNode {
    id: string;
    label: string;
    kind: 'entry' | 'exit' | 'basic_block' | 'condition' | 'loop' | 'call';
    startLine: number;
    endLine: number;
}

export interface CFGEdge {
    from: string;
    to: string;
    label?: string; // e.g., "true", "false"
}

export interface CFG {
    nodes: CFGNode[];
    edges: CFGEdge[];
}

export interface DFGNode {
    id: string;
    label: string;
    kind: 'variable' | 'parameter' | 'return' | 'expression';
    line: number;
}

export interface DFGEdge {
    from: string;
    to: string;
    kind: 'read' | 'write' | 'dependency';
}

export interface DFG {
    nodes: DFGNode[];
    edges: DFGEdge[];
}

export interface GraphGeneratorContext {
    node: Parser.SyntaxNode;
    file: string;
    code: string;
}

export interface GraphGenerator {
    generateCFG(context: GraphGeneratorContext): Promise<CFG>;
    generateDFG(context: GraphGeneratorContext): Promise<DFG>;
}

export type GraphStrategy = 'internal' | 'external';

export class GraphManager {
    private generators: Map<string, Map<GraphStrategy, GraphGenerator>> = new Map();

    register(lang: string, strategy: GraphStrategy, generator: GraphGenerator) {
        if (!this.generators.has(lang)) {
            this.generators.set(lang, new Map());
        }
        this.generators.get(lang)!.set(strategy, generator);
    }

    getGenerator(lang: string, strategy: GraphStrategy): GraphGenerator | undefined {
        return this.generators.get(lang)?.get(strategy);
    }

    async generateGraphs(lang: string, context: GraphGeneratorContext, strategy: GraphStrategy = 'internal', enableCfg: boolean = true, enableDfg: boolean = true): Promise<{ cfg?: CFG; dfg?: DFG }> {
        const generator = this.getGenerator(lang, strategy);
        if (!generator) {
            // Fallback to internal if external requested but not found?
            // Or just return empty.
            // For now, strict.
            return {};
        }

        try {
            const promises: Promise<CFG | DFG>[] = [];

            if (enableCfg) {
                promises.push(generator.generateCFG(context));
            }
            if (enableDfg) {
                promises.push(generator.generateDFG(context));
            }

            // If neither is enabled, return empty
            if (!enableCfg && !enableDfg) {
                return {};
            }

            const results = await Promise.all(promises);
            const response: { cfg?: CFG; dfg?: DFG } = {};

            let resultIndex = 0;
            if (enableCfg) {
                response.cfg = results[resultIndex++] as CFG;
            }
            if (enableDfg) {
                response.dfg = results[resultIndex++] as DFG;
            }

            return response;
        } catch (e) {
            Logger.warn(`Failed to generate graphs for ${lang} using ${strategy} strategy: ${e}`);
            return {};
        }
    }
}

export const graphManager = new GraphManager();
