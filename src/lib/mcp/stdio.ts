/**
 * stdio binding for kit's framework-free MCP handler.
 *
 * Kit's handler takes one HTTP-shaped request per JSON-RPC message. The
 * stdio transport is newline-delimited JSON-RPC: each input line is fed
 * to the handler as a POST body and the response body is written as
 * one output line. Notifications get no reply (JSON-RPC 2.0) and
 * `ping` is answered here; the handler covers initialize, tools/list
 * and tools/call. Requests run concurrently; replies carry their id.
 */
import * as readline from 'readline';
import type { McpHandler } from '@hop-top/kit/dist/mcp';

export interface StdioOptions {
  input: NodeJS.ReadableStream;
  /** Writes one protocol line; the only path to the protocol stream. */
  write: (line: string) => void;
  /** Diagnostics sink (stderr). */
  log?: (msg: string) => void;
}

type Message = { id?: unknown; method?: unknown };

function peek(line: string): Message | undefined {
  try {
    const v = JSON.parse(line);
    return v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Message) : undefined;
  } catch {
    return undefined;
  }
}

/** Serve `handler` over newline-delimited stdio until input ends. */
export function serveStdio(handler: McpHandler, o: StdioOptions): Promise<void> {
  const inflight = new Set<Promise<void>>();
  const rl = readline.createInterface({ input: o.input, crlfDelay: Infinity });

  const reply = (body: string) => {
    if (body === '') return;
    o.write(body.endsWith('\n') ? body : `${body}\n`);
  };

  const handle = async (line: string) => {
    const msg = peek(line);
    if (msg) {
      const isRequest = 'id' in msg && typeof msg.method === 'string';
      // Notifications and responses to server requests: no reply.
      if (!('id' in msg)) return;
      if (!isRequest) return;
      if (msg.method === 'ping') {
        reply(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: {} }));
        return;
      }
    }
    try {
      const res = await handler({
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: line,
      });
      reply(res.body);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      o.log?.(`xray mcp: ${message}`);
      if (msg && 'id' in msg) {
        reply(JSON.stringify({ jsonrpc: '2.0', id: msg.id, error: { code: -32603, message } }));
      }
    }
  };

  rl.on('line', (raw) => {
    const line = raw.trim();
    if (line === '') return;
    const p = handle(line).finally(() => inflight.delete(p));
    inflight.add(p);
  });

  return new Promise((resolve) => {
    rl.on('close', () => {
      void Promise.all([...inflight]).then(() => resolve());
    });
  });
}
