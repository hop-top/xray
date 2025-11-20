
import Parser from 'tree-sitter';
import { CFG, CFGNode, CFGEdge, DFG, DFGNode, DFGEdge, GraphGenerator, GraphGeneratorContext } from '../flow-analysis';

export class CSharpGraphGenerator implements GraphGenerator {
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
                case 'if_statement':
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
                        }
                    }
                    break;
                case 'for_statement':
                case 'foreach_statement':
                case 'while_statement':
                    const loopCond = n.childForFieldName('condition'); // foreach has 'collection' usually, need check grammar
                    const loopBody = n.childForFieldName('body');

                    let label = 'loop';
                    if (loopCond) label = `loop (${loopCond.text})`;
                    else if (n.type === 'foreach_statement') {
                        const collection = n.childForFieldName('collection');
                        if (collection) label = `foreach (${collection.text})`;
                    }

                    const loopNode = createNode(label, 'loop', n);
                    edges.push({ from: current.id, to: loopNode.id });
                    current = loopNode;
                    if (loopBody) traverse(loopBody);
                    break;
                case 'return_statement':
                    const retNode = createNode(n.text, 'exit', n);
                    edges.push({ from: current.id, to: retNode.id });
                    current = retNode;
                    break;
                case 'expression_statement':
                case 'local_declaration_statement':
                    const step = createNode(n.text, 'basic_block', n);
                    edges.push({ from: current.id, to: step.id });
                    current = step;
                    break;
                case 'try_statement':
                    const tryBlock = n.childForFieldName('body');
                    if (tryBlock) traverse(tryBlock);
                    for (const child of n.children) {
                        if (child.type === 'catch_clause') {
                            const catchBody = child.childForFieldName('body');
                            if (catchBody) traverse(catchBody);
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
