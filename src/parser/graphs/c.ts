import Parser from 'tree-sitter';
import { CFG, CFGNode, CFGEdge, DFG, DFGNode, DFGEdge, GraphGenerator, GraphGeneratorContext } from '../flow-analysis';

export class CGraphGenerator implements GraphGenerator {
    async generateCFG(context: GraphGeneratorContext): Promise<CFG> {
        const { node } = context;
        const nodes: CFGNode[] = [];
        const edges: CFGEdge[] = [];
        let nodeIdCounter = 0;

        const createNode = (label: string, kind: CFGNode['kind'], n: Parser.SyntaxNode): CFGNode => {
            const id = `cfg_${nodeIdCounter++} `;
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

        // Recursive traversal to build CFG
        // This is a simplified implementation. A full one would handle all C control structures.
        let current = entry;

        const traverse = (n: Parser.SyntaxNode) => {
            switch (n.type) {
                case 'compound_statement':
                    for (const child of n.children) {
                        traverse(child);
                    }
                    break;
                case 'if_statement':
                    const condition = n.childForFieldName('condition');
                    const consequence = n.childForFieldName('consequence');
                    const alternative = n.childForFieldName('alternative');

                    if (condition) {
                        const condNode = createNode(`if (${condition.text})`, 'condition', condition);
                        edges.push({ from: current.id, to: condNode.id });

                        // True branch
                        current = condNode;
                        if (consequence) {
                            const trueLabel = createNode('True', 'basic_block', consequence);
                            edges.push({ from: condNode.id, to: trueLabel.id, label: 'true' });
                            current = trueLabel;
                            traverse(consequence);
                        }

                        // False branch
                        if (alternative) {
                            // Reset current to condition for the false branch
                            // Note: This simple linear traversal is insufficient for branching. 
                            // We need to track 'exit' points of blocks.
                            // For MVP, we just link condition to alternative.
                            const falseLabel = createNode('False', 'basic_block', alternative);
                            edges.push({ from: condNode.id, to: falseLabel.id, label: 'false' });
                            // We would need to traverse alternative here and merge paths.
                        }
                    }
                    break;
                case 'return_statement':
                    const retNode = createNode(n.text, 'exit', n);
                    edges.push({ from: current.id, to: retNode.id });
                    current = retNode; // Flow stops or merges to exit
                    break;
                case 'expression_statement':
                case 'declaration':
                    const step = createNode(n.text, 'basic_block', n);
                    edges.push({ from: current.id, to: step.id });
                    current = step;
                    break;
                // ... handle loops, etc.
            }
        };

        // Start traversal from the function body
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

        // Simplified DFG: track variable declarations and usages
        // A real DFG requires reaching definitions analysis.

        const traverse = (n: Parser.SyntaxNode) => {
            if (n.type === 'identifier') {
                // Check if it's a usage or declaration
                // This is very naive
                nodes.push({
                    id: `dfg_${nodeIdCounter++} `,
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
