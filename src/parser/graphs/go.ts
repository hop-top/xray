import Parser from 'tree-sitter';
import { CFG, CFGNode, CFGEdge, DFG, DFGNode, DFGEdge, GraphGenerator, GraphGeneratorContext } from '../flow-analysis';

export class GoGraphGenerator implements GraphGenerator {
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
            // console.log('Traversing:', n.type);
            switch (n.type) {
                case 'block':
                case 'statement_list':
                    for (const child of n.children) {
                        traverse(child);
                    }
                    break;
                case 'if_statement':
                    const condition = n.childForFieldName('condition');
                    // console.log('If statement found. Condition:', condition ? condition.type : 'NONE');
                    const consequence = n.childForFieldName('consequence');
                    const alternative = n.childForFieldName('alternative');

                    if (condition) {
                        // console.log('Creating condition node');
                        const condNode = createNode(`if (${condition.text || ''})`, 'condition', condition);
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
                            // Note: Go's alternative can be another if_statement (else if) or a block (else)
                            if (alternative.type === 'if_statement') {
                                traverse(alternative);
                            } else {
                                // else block
                                // traverse(alternative); // We should traverse the block
                            }
                        }
                    }
                    break;
                case 'for_statement':
                    // Go only has 'for', which handles while/foreach/c-style for
                    let loopCond = n.childForFieldName('condition');
                    const loopBody = n.childForFieldName('body');

                    // Handle for_clause (new in tree-sitter-go 0.25)
                    if (!loopCond) {
                        // console.log('No direct condition, checking for_clause');
                        const forClause = n.children.find(c => c.type === 'for_clause');
                        if (forClause) {
                            loopCond = forClause.childForFieldName('condition');
                            // console.log('Found condition via for_clause:', loopCond ? loopCond.type : 'NONE');
                        }
                    }

                    let label = 'loop';
                    if (loopCond) label = `loop (${loopCond.text || ''})`;

                    const loopNode = createNode(label, 'loop', n);
                    edges.push({ from: current.id, to: loopNode.id });
                    current = loopNode;
                    if (loopBody) traverse(loopBody);
                    break;
                case 'return_statement':
                    const retNode = createNode(n.text || 'return', 'exit', n);
                    edges.push({ from: current.id, to: retNode.id });
                    current = retNode;
                    break;
                case 'expression_statement':
                case 'short_var_declaration':
                case 'var_declaration':
                case 'assignment_statement':
                case 'defer_statement':
                    const step = createNode(n.text || n.type, 'basic_block', n);
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
