import * as fs from 'fs';
import * as path from 'path';
import { Logger } from './logger';

export class QueryResolver {
    private static EXT_MAP: Record<string, string[]> = {
        'python': ['.py'],
        'typescript': ['.ts', '.tsx'],
        'javascript': ['.js', '.jsx'],
        'go': ['.go'],
        'rust': ['.rs'],
        'java': ['.java'],
        'c_sharp': ['.cs'],
        'cpp': ['.cpp', '.hpp', '.cc', '.cxx'],
        'c': ['.c', '.h'],
        'ruby': ['.rb'],
        'php': ['.php'],
        'swift': ['.swift'],
        'bash': ['.sh', '.bash'],
        'kotlin': ['.kt'],
        'scala': ['.scala'],
        'dart': ['.dart'],
        'lua': ['.lua'],
        'elixir': ['.ex', '.exs'],
        'haskell': ['.hs'],
    };

    // Map aliases/abbreviations to the canonical language key in EXT_MAP
    private static ALIAS_MAP: Record<string, string> = {
        'py': 'python',
        'js': 'javascript',
        'jsx': 'javascript',
        'ts': 'typescript',
        'tsx': 'typescript',
        'rb': 'ruby',
        'sh': 'bash',
        'rs': 'rust',
        'cs': 'c_sharp',
        'kt': 'kotlin',
        'ex': 'elixir',
        'hs': 'haskell',
    };

    static resolve(inputs: string[]): Record<string, string> {
        const queries: Record<string, string> = {};

        for (const input of inputs) {
            // Handle comma-separated lists
            const parts = input.split(',');
            for (const part of parts) {
                const trimmed = part.trim();
                if (!trimmed) continue;
                this.processSingleInput(trimmed, queries);
            }
        }

        return queries;
    }

    private static processSingleInput(input: string, queries: Record<string, string>) {
        // Check for explicit mapping (ext:path)
        const colonIndex = input.indexOf(':');

        let isExplicitMapping = false;
        if (colonIndex > 0) {
            const prefix = input.substring(0, colonIndex);
            // If prefix starts with '.', assume it's an extension mapping
            if (prefix.startsWith('.')) {
                isExplicitMapping = true;
            }
        }

        if (isExplicitMapping) {
            const ext = input.substring(0, colonIndex);
            const pathOrUrl = input.substring(colonIndex + 1);
            queries[ext] = pathOrUrl;
            return;
        }

        // Otherwise, treat as path/URL and try to infer
        this.resolvePathOrUrl(input, queries);
    }

    private static resolvePathOrUrl(pathOrUrl: string, queries: Record<string, string>) {
        // If it's a URL, we can only infer from the filename
        if (pathOrUrl.startsWith('http://') || pathOrUrl.startsWith('https://')) {
            const parts = pathOrUrl.split('/');
            const filename = parts[parts.length - 1];
            this.inferFromFilename(filename, pathOrUrl, queries);
            return;
        }

        // It's a local path
        if (!fs.existsSync(pathOrUrl)) {
            Logger.warn(`Warning: Query path not found: ${pathOrUrl}`);
            return;
        }

        const stats = fs.statSync(pathOrUrl);
        if (stats.isDirectory()) {
            // Scan directory for .scm files
            const files = fs.readdirSync(pathOrUrl);
            for (const file of files) {
                if (file.endsWith('.scm')) {
                    const fullPath = path.join(pathOrUrl, file);
                    this.inferFromFilename(file, fullPath, queries);
                }
            }
        } else {
            // Single file
            this.inferFromFilename(path.basename(pathOrUrl), pathOrUrl, queries);
        }
    }

    private static inferFromFilename(filename: string, fullPath: string, queries: Record<string, string>) {
        const lower = filename.toLowerCase();

        // Remove extension (.scm) if present for matching
        const name = lower.replace(/\.scm$/, '');

        // 1. Check against full language names
        for (const [lang, exts] of Object.entries(this.EXT_MAP)) {
            // Match "python", "python.tags", "python-tags", "my-python-query"
            // We look for the language name as a distinct word or segment
            if (this.isMatch(name, lang)) {
                for (const ext of exts) {
                    queries[ext] = fullPath;
                }
                return;
            }
        }

        // 2. Check against aliases
        for (const [alias, lang] of Object.entries(this.ALIAS_MAP)) {
            if (this.isMatch(name, alias)) {
                const exts = this.EXT_MAP[lang];
                if (exts) {
                    for (const ext of exts) {
                        queries[ext] = fullPath;
                    }
                }
                return;
            }
        }

        Logger.warn(`Warning: Could not infer language from filename '${filename}'. Use explicit mapping (e.g. .ts:${fullPath})`);
    }

    private static isMatch(filename: string, token: string): boolean {
        // Exact match
        if (filename === token) return true;

        // Delimiters: . - _
        // Check if token appears bounded by delimiters or start/end
        const regex = new RegExp(`(^|[._-])${token}([._-]|$)`);
        return regex.test(filename);
    }
}
