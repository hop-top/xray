import { ParserManager } from '../../src/lib/parser/manager';
import Parser from 'tree-sitter';
const Swift = require('tree-sitter-swift');
const Kotlin = require('tree-sitter-kotlin');
const Elixir = require('tree-sitter-elixir');
const Haskell = require('tree-sitter-haskell');

describe('AST Debug', () => {
    function printTree(node: Parser.SyntaxNode, indent = 0): void {
        const prefix = '  '.repeat(indent);
        const text = (node.text || '').replace(/\n/g, '\\n').substring(0, 40);
        console.log(`${prefix}${node.type} "${text}"`);
        for (const child of node.children) {
            printTree(child, indent + 1);
        }
    }

    it('Bash AST', () => {
        const parser = new Parser();
        const Bash = require('tree-sitter-bash');
        parser.setLanguage(Bash);
        const tree = parser.parse('source ./utils.sh\n. ./config.sh');
        console.log('--- Bash ---');
        printTree(tree.rootNode);
    });

    it('C# AST', () => {
        const parser = new Parser();
        const CSharp = require('tree-sitter-c-sharp');
        parser.setLanguage(CSharp);
        const tree = parser.parse('using System;\nusing System.Collections.Generic;');
        console.log('--- C# ---');
        printTree(tree.rootNode);
    });

    it('C++ AST', () => {
        const parser = new Parser();
        const CPP = require('tree-sitter-cpp');
        parser.setLanguage(CPP);
        const tree = parser.parse('#include <iostream>\n#include "myheader.h"');
        console.log('--- C++ ---');
        printTree(tree.rootNode);
    });

    it('PHP AST', () => {
        const parser = new Parser();
        const PHP = require('tree-sitter-php');
        parser.setLanguage(PHP.php);
        const tree = parser.parse('<?php\nuse App\\Models\\User;\nrequire "config.php";');
        console.log('--- PHP ---');
        printTree(tree.rootNode);
    });

    it('Swift AST', () => {
        const parser = new Parser();
        parser.setLanguage(Swift);
        const tree = parser.parse('import Foundation');
        console.log('--- Swift ---');
        printTree(tree.rootNode);
    });

    it('Kotlin AST', () => {
        const parser = new Parser();
        parser.setLanguage(Kotlin);
        const tree = parser.parse('import java.util.List');
        console.log('--- Kotlin ---');
        printTree(tree.rootNode);
    });

    it('Elixir AST', () => {
        const parser = new Parser();
        parser.setLanguage(Elixir);
        const tree = parser.parse('import List');
        console.log('--- Elixir ---');
        printTree(tree.rootNode);
    });

    it('Haskell AST', () => {
        const parser = new Parser();
        parser.setLanguage(Haskell);
        const tree = parser.parse('import Data.List');
        console.log('--- Haskell ---');
        printTree(tree.rootNode);
    });
});
