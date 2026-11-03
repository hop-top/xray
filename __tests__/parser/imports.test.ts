import { ParserManager } from '../../src/lib/parser/manager';
import * as path from 'path';

describe('ParserManager Imports', () => {
    let manager: ParserManager;

    beforeEach(() => {
        manager = new ParserManager('/root');
    });

    it('should extract typescript imports', async () => {
        const content = `
            import fs from 'fs';
            import { join } from 'path';
            import * as parser from '../parser';
            const x = require('util'); // require not yet supported in query but good to check
        `;

        const result = await manager.parse('test.ts', content);

        // Check imports
        const fsImport = result.imports.find(i => i.source === 'fs');
        const pathImport = result.imports.find(i => i.source === 'path');
        const localImport = result.imports.find(i => i.source === '../parser');

        expect(fsImport).toBeDefined();
        expect(pathImport).toBeDefined();
        expect(localImport).toBeDefined();
    });

    it('should extract imports from Python', async () => {
        const code = `
import os
from utils import parser
from .. import config
`;
        const { imports } = await manager.parse('test.py', code);
        expect(imports).toHaveLength(3);
        expect(imports[0].source).toBe('os');
        expect(imports[1].source).toBe('utils');
        expect(imports[2].source).toBe('..'); // Relative import
    });

    it('should extract imports from Go', async () => {
        const code = `
package main
import (
    "fmt"
    "net/http"
)
import "os"
`;
        const { imports } = await manager.parse('main.go', code);
        expect(imports).toHaveLength(3);
        expect(imports[0].source).toBe('fmt');
        expect(imports[1].source).toBe('net/http');
        expect(imports[2].source).toBe('os');
    });

    it('should extract imports from Java', async () => {
        const code = `
package com.example;
import java.util.List;
import java.io.*;
`;
        const { imports } = await manager.parse('Test.java', code);
        expect(imports).toHaveLength(2);
        expect(imports[0].source).toBe('java.util.List');
        expect(imports[1].source).toBe('java.io'); // Just the base, asterisk is not captured
    });

    it('should extract imports from Rust', async () => {
        const code = `
use std::io;
use std::collections::HashMap;
`;
        const { imports } = await manager.parse('main.rs', code);
        expect(imports).toHaveLength(2);
        expect(imports[0].source).toBe('std::io');
        expect(imports[1].source).toBe('std::collections::HashMap');
    });

    it('should extract imports from C', async () => {
        const code = `
#include <stdio.h>
#include "myheader.h"
`;
        const { imports } = await manager.parse('main.c', code);
        expect(imports).toHaveLength(2);
        expect(imports[0].source).toBe('<stdio.h>');
        expect(imports[1].source).toBe('myheader.h');
    });

    it('should extract imports from Ruby', async () => {
        const code = `
require 'json'
require_relative 'utils'
`;
        const { imports } = await manager.parse('main.rb', code);
        expect(imports).toHaveLength(2);
        expect(imports[0].source).toBe('json');
        expect(imports[1].source).toBe('utils');
    });

    it('should extract imports from JavaScript', async () => {
        const code = `
            import fs from 'fs';
            const path = require('path');
        `;
        const { imports } = await manager.parse('test.js', code);
        expect(imports).toHaveLength(2);
        expect(imports[0].source).toBe('fs');
        expect(imports[1].source).toBe('path');
    });

    it('should extract imports from C#', async () => {
        const code = `
            using System;
            using System.Collections.Generic;
        `;
        const { imports } = await manager.parse('test.cs', code);
        expect(imports).toHaveLength(2);
        expect(imports[0].source).toBe('System');
        expect(imports[1].source).toBe('System.Collections.Generic');
    });

    it('should extract imports from C++', async () => {
        const code = `
            #include <iostream>
            #include "myheader.h"
        `;
        const { imports } = await manager.parse('test.cpp', code);
        expect(imports).toHaveLength(2);
        expect(imports[0].source).toBe('<iostream>');
        expect(imports[1].source).toBe('myheader.h');
    });

    it('should extract imports from Bash', async () => {
        const code = `
            source ./utils.sh
            . ./config.sh
        `;
        const { imports } = await manager.parse('test.sh', code);
        expect(imports).toHaveLength(2);
        expect(imports[0].source).toBe('./utils.sh');
        expect(imports[1].source).toBe('./config.sh');
    });

    it('should extract imports from PHP', async () => {
        const code = `
            <?php
            use App\\Models\\User;
            require 'config.php';
            include_once 'utils.php';
        `;
        const { imports } = await manager.parse('test.php', code);
        expect(imports).toHaveLength(3);
        expect(imports[0].source).toBe('App\\Models\\User');
        expect(imports[1].source).toBe('config.php');
        expect(imports[2].source).toBe('utils.php');
    });

    it('should extract imports from Swift', async () => {
        const code = `
            import Foundation
            import UIKit
        `;
        const { imports } = await manager.parse('test.swift', code);
        expect(imports).toHaveLength(2);
        expect(imports[0].source).toBe('Foundation');
        expect(imports[1].source).toBe('UIKit');
    });

    it('should extract imports from Kotlin', async () => {
        const code = `
            import java.util.List
            import com.example.MyClass
        `;
        const { imports } = await manager.parse('test.kt', code);
        expect(imports).toHaveLength(2);
        expect(imports[0].source).toBe('java.util.List');
        expect(imports[1].source).toBe('com.example.MyClass');
    });

    it('should extract imports from Scala', async () => {
        const code = `
            import java.util.List
            import scala.collection.mutable
        `;
        const { imports } = await manager.parse('test.scala', code);
        expect(imports).toHaveLength(2);
        expect(imports[0].source).toBe('java.util.List');
        expect(imports[1].source).toBe('scala.collection.mutable');
    });

    it.skip('should extract imports from Dart', async () => {
        const code = `
            import 'package:http/http.dart' as http;
            import 'dart:async';
        `;
        const { imports } = await manager.parse('test.dart', code);
        expect(imports).toHaveLength(2);
        expect(imports[0].source).toBe('package:http/http.dart');
        expect(imports[1].source).toBe('dart:async');
    });

    it.skip('should extract imports from Lua', async () => {
        const code = `
            local json = require("json")
            require "utils"
        `;
        const { imports } = await manager.parse('test.lua', code);
        expect(imports).toHaveLength(2);
        expect(imports[0].source).toBe('json');
        expect(imports[1].source).toBe('utils');
    });

    it('should extract imports from Elixir', async () => {
        const code = `
            import List
            alias My.Module
            require Logger
        `;
        const { imports } = await manager.parse('test.ex', code);
        expect(imports).toHaveLength(3);
        expect(imports[0].source).toBe('List');
        expect(imports[1].source).toBe('My.Module');
        expect(imports[2].source).toBe('Logger');
    });

    it('should extract imports from Haskell', async () => {
        const code = `
            import Data.List
            import qualified Data.Map as Map
        `;
        const { imports } = await manager.parse('test.hs', code);
        expect(imports).toHaveLength(2);
        expect(imports[0].source).toBe('Data.List');
        expect(imports[1].source).toBe('Data.Map');
    });

    it('parses .tsx with the tsx grammar (imports after JSX are kept)', async () => {
        const code = [
            "import React from 'react';",
            "const App = () => <div className=\"x\">it's {1 < 2 ? <b>a</b> : null}</div>;",
            "import { later } from './later';",
            "export function View() { return <App />; }",
        ].join('\n');
        const result = await manager.parse('view.tsx', code);
        expect(result.imports.map(i => i.source)).toEqual(['react', './later']);
        expect(result.tags.map(t => t.name)).toEqual(expect.arrayContaining(['App', 'View']));
    });

});
