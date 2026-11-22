/**
 * Structured JSONL audit logger for auth, scoped-token, gateway, and admin events.
 * High-volume routine search and file-read traffic is intentionally excluded.
 */
import * as fs from 'fs';
import type * as http from 'http';
import * as path from 'path';

export interface AuditEvent {
  ts: string;
  event: string;
  actor: string;
  target: string;
  status: string;
}

export class AuditLogger {
  readonly filePath: string;

  constructor(filePath: string) {
    this.filePath = path.resolve(filePath);
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
  }

  log(entry: Omit<AuditEvent, 'ts'> & { ts?: string }): void {
    const record: AuditEvent = {
      ts: entry.ts ?? new Date().toISOString(),
      event: entry.event,
      actor: entry.actor,
      target: entry.target,
      status: entry.status,
    };
    fs.appendFileSync(this.filePath, `${JSON.stringify(record)}\n`, 'utf8');
  }
}

export function createAuditLogger(auditLogPath?: string | null): AuditLogger | null {
  if (!auditLogPath || !auditLogPath.trim()) return null;
  return new AuditLogger(auditLogPath.trim());
}

export function actorFromRequest(req: http.IncomingMessage): string {
  const remote = req.socket?.remoteAddress;
  return remote && remote.length > 0 ? remote : 'unknown';
}
