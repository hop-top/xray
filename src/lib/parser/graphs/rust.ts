import Parser from 'tree-sitter';
import { CFG, CFGNode, CFGEdge, DFG, DFGNode, DFGEdge, GraphGenerator, GraphGeneratorContext } from '../flow-analysis';

export class RustGraphGenerator implements GraphGenerator {
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

        const entry = createNode('Entry', 'entry', node);
        let current = entry;

        const traverse = (n: Parser.SyntaxNode) => {
            switch (n.type) {
                case 'block':
                    for (const child of n.children) {
                        traverse(child);
                    }
                    break;
                case 'if_expression':
                    const condition = n.childForFieldName('condition');
                    const consequence = n.childForFieldName('consequence');
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
                            // Rust alternative is a block or if_expression
                            traverse(alternative);
                        }
                    }
                    break;
                case 'for_expression':
                case 'while_expression':
                case 'loop_expression':
                    const loopCond = n.childForFieldName('condition');
                    const loopBody = n.childForFieldName('body');

                    let label = 'loop';
                    if (loopCond) label = `loop (${loopCond.text})`;
                    else if (n.type === 'for_expression') {
                        const pattern = n.childForFieldName('pattern');
                        const value = n.childForFieldName('value');
                        if (value) label = `for (${value.text})`;
                    }

                    const loopNode = createNode(label, 'loop', n);
                    edges.push({ from: current.id, to: loopNode.id });
                    current = loopNode;
                    if (loopBody) traverse(loopBody);
                    break;
                case 'return_expression':
                    const retNode = createNode(n.text, 'exit', n);
                    edges.push({ from: current.id, to: retNode.id });
                    current = retNode;
                    break;
                case 'expression_statement':
                    let handled = false;
                    for (const child of n.children) {
                        if (['if_expression', 'for_expression', 'while_expression', 'loop_expression', 'match_expression', 'return_expression', 'assignment_expression', 'block'].includes(child.type)) {
                            traverse(child);
                            handled = true;
                        }
                    }
                    if (!handled) {
                        const step = createNode(n.text, 'basic_block', n);
                        edges.push({ from: current.id, to: step.id });
                        current = step;
                    }
                    break;
                case 'let_declaration':
                case 'assignment_expression':
                case 'match_expression':
                    const matchNode = createNode('match', 'condition', n);
                    edges.push({ from: current.id, to: matchNode.id });
                    current = matchNode;
                    const matchBody = n.childForFieldName('body');
                    if (matchBody) {
                        for (const arm of matchBody.children) {
                            if (arm.type === 'match_arm') {
                                const pattern = arm.childForFieldName('pattern');
                                const value = arm.childForFieldName('value');
                                if (pattern && value) {
                                    const armNode = createNode(`case ${pattern.text}`, 'basic_block', value);
                                    edges.push({ from: matchNode.id, to: armNode.id });
                                    traverse(value);
                                }
                            }
                        }
                    }
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
