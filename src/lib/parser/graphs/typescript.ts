import Parser from 'tree-sitter';
import { CFG, CFGNode, CFGEdge, DFG, DFGNode, DFGEdge, GraphGenerator, GraphGeneratorContext } from '../flow-analysis';

export class TypeScriptGraphGenerator implements GraphGenerator {
    async generateCFG(context: GraphGeneratorContext): Promise<CFG> {
        const { node } = context;
        const nodes: CFGNode[] = [];
        const edges: CFGEdge[] = [];
        let nodeIdCounter = 0;

        const createNode = (label: string, kind: CFGNode['kind'], n: Parser.SyntaxNode): CFGNode => {
            const id = `cfg_${nodeIdCounter++}`;
            const nodeObj: CFGNode = {
                id,
                label,
                kind,
                startLine: n.startPosition.row,
                endLine: n.endPosition.row,
            };
            nodes.push(nodeObj);
            return nodeObj;
        };

        // Entry node
        const entry = createNode('Entry', 'entry', node);

        let current = entry;

        const traverse = (n: Parser.SyntaxNode) => {
            switch (n.type) {
                case 'statement_block':
                    for (const child of n.children) {
                        traverse(child);
                    }
                    break;
                case 'if_statement':
                    const condition = n.childForFieldName('condition') || n.childForFieldName('test');
                    const consequence = n.childForFieldName('consequence') || n.childForFieldName('body');
                    const alternative = n.childForFieldName('alternative');
                    if (condition) {
                        const condNode = createNode(`if (${condition.text})`, 'condition', condition);
                        edges.push({ from: current.id, to: condNode.id });

                        current = condNode;
                        if (consequence) {
                            const trueLabel = createNode('True', 'basic_block', consequence);
                            edges.push({ from: condNode.id, to: trueLabel.id, label: 'true' });
                            current = trueLabel;
                            traverse(consequence);
                        }

                        if (alternative) {
                            const falseLabel = createNode('False', 'basic_block', alternative);
                            edges.push({ from: condNode.id, to: falseLabel.id, label: 'false' });
                        }
                    }
                    break;
                case 'return_statement':
                    const retNode = createNode(n.text, 'exit', n);
                    edges.push({ from: current.id, to: retNode.id });
                    current = retNode;
                    break;
                case 'expression_statement':
                    const step = createNode(n.text, 'basic_block', n);
                    edges.push({ from: current.id, to: step.id });
                    current = step;
                    break;
            }
        };

        const body = node.childForFieldName('body');
        if (body) {
            traverse(body);
        }

        return { nodes, edges };
    }

    async generateDFG(context: GraphGeneratorContext): Promise<DFG> {
        const { node } = context;
        const nodes: DFGNode[] = [];
        const edges: DFGEdge[] = [];
        let nodeIdCounter = 0;

        const traverse = (n: Parser.SyntaxNode) => {
            if (n.type === 'identifier') {
                nodes.push({
                    id: `dfg_${nodeIdCounter++}`,
                    label: n.text,
                    kind: 'variable',
                    line: n.startPosition.row
                });
            }
            for (const child of n.children) {
                traverse(child);
            }
        };

        traverse(node);

        return { nodes, edges };
    }
}