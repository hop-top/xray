/**
 * Scoped bearer tokens (`xrst_`) for the MCP HTTP transport.
 *
 * Tokens are HMAC-SHA256 signed JSON payloads with a 3600s max TTL,
 * non-refreshable, and revocable by `jti` via an in-memory revocation set.
 * Per-request root narrowing is propagated via AsyncLocalStorage so
 * `WarmWorkspaceManager.containAcrossAllowedRoots` enforces the intersection
 * of `token.roots` and the server's `allowedRoots`.
 */
import { AsyncLocalStorage } from 'async_hooks';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { isWithin, realpathLoose } from '../confine';

export const SCOPED_TOKEN_PREFIX = 'xrst_';
export const SCOPED_TOKEN_TTL_SECONDS = 3600;

export interface ScopedTokenClaims {
  roots: string[];
  exp: number;
  jti: string;
}

export interface MintOptions {
  ttlSeconds?: number;
  nowSeconds?: number;
}

export interface MintedToken {
  token: string;
  claims: ScopedTokenClaims;
}

const scopedRootsStorage = new AsyncLocalStorage<ReadonlySet<string>>();

/** Run `fn` with per-request `allowedRoots` narrowing active. */
export function runWithScopedRoots<T>(roots: ReadonlySet<string>, fn: () => T): T {
  return scopedRootsStorage.run(roots, fn);
}

/** Return the per-request narrowed `allowedRoots`, or `undefined` if unscoped. */
export function getScopedRoots(): ReadonlySet<string> | undefined {
  return scopedRootsStorage.getStore();
}

/** Constant-time string comparison using SHA-256 digests + `timingSafeEqual`. */
export function timingSafeEqualStrings(a: string, b: string): boolean {
  const ha = crypto.createHash('sha256').update(a, 'utf8').digest();
  const hb = crypto.createHash('sha256').update(b, 'utf8').digest();
  return crypto.timingSafeEqual(ha, hb);
}

/**
 * Intersect `tokenRoots` with `serverAllowedRoots`.
 * A token root inside a server root narrows access to that subtree;
 * a token root enclosing a server root is clamped to the server root;
 * disjoint roots yield no access.
 */
export function intersectAllowedRoots(
  tokenRoots: readonly string[],
  serverAllowedRoots: ReadonlySet<string>,
  serverRoot: string
): Set<string> {
  const result = new Set<string>();
  const resolvedServerRoots = [...serverAllowedRoots].map((r) => {
    try {
      return fs.realpathSync(r);
    } catch {
      return realpathLoose(r);
    }
  });

  for (const raw of tokenRoots) {
    if (typeof raw !== 'string' || raw.trim() === '') continue;
    const abs = path.resolve(serverRoot, raw);
    const realToken = realpathLoose(abs);

    for (const realServer of resolvedServerRoots) {
      if (isWithin(realServer, realToken)) {
        result.add(realToken);
      } else if (isWithin(realToken, realServer)) {
        result.add(realServer);
      }
    }
  }
  return result;
}

export class ScopedTokenManager {
  private readonly secret: Buffer;
  private readonly revoked = new Set<string>();

  constructor(secret: string | Buffer) {
    if (!secret || secret.length === 0) {
      throw new Error('ScopedTokenManager requires a non-empty secret');
    }
    this.secret = typeof secret === 'string' ? Buffer.from(secret, 'utf8') : Buffer.from(secret);
  }

  /** Mint a signed `xrst_` token and return both the token string and its claims. */
  mintDetailed(roots: readonly string[], opts: MintOptions = {}): MintedToken {
    const now = opts.nowSeconds ?? Math.floor(Date.now() / 1000);
    const rawTtl = opts.ttlSeconds ?? SCOPED_TOKEN_TTL_SECONDS;
    const ttl = Math.min(SCOPED_TOKEN_TTL_SECONDS, Math.floor(rawTtl));
    const claims: ScopedTokenClaims = {
      roots: [...roots],
      exp: now + ttl,
      jti: crypto.randomUUID(),
    };
    const payloadB64 = Buffer.from(JSON.stringify(claims), 'utf8').toString('base64url');
    const sigB64 = crypto.createHmac('sha256', this.secret).update(payloadB64).digest('base64url');
    return {
      token: `${SCOPED_TOKEN_PREFIX}${payloadB64}.${sigB64}`,
      claims,
    };
  }

  /** Mint a signed `xrst_` token string. */
  mint(roots: readonly string[], opts: MintOptions = {}): string {
    return this.mintDetailed(roots, opts).token;
  }

  /** Verify signature (`timingSafeEqual`), expiration, and revocation status. */
  verify(token: string, nowSeconds?: number): ScopedTokenClaims | null {
    if (typeof token !== 'string' || !token.startsWith(SCOPED_TOKEN_PREFIX)) {
      return null;
    }
    const rest = token.slice(SCOPED_TOKEN_PREFIX.length);
    const dot = rest.indexOf('.');
    if (dot <= 0 || rest.indexOf('.', dot + 1) !== -1) {
      return null;
    }
    const payloadB64 = rest.slice(0, dot);
    const sigB64 = rest.slice(dot + 1);
    if (!payloadB64 || !sigB64) {
      return null;
    }

    const expectedSig = crypto.createHmac('sha256', this.secret).update(payloadB64).digest();
    let actualSig: Buffer;
    try {
      actualSig = Buffer.from(sigB64, 'base64url');
    } catch {
      return null;
    }
    if (actualSig.length !== expectedSig.length || !crypto.timingSafeEqual(actualSig, expectedSig)) {
      return null;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
    } catch {
      return null;
    }
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return null;
    }
    const obj = parsed as Record<string, unknown>;
    if (
      !Array.isArray(obj.roots) ||
      !obj.roots.every((r) => typeof r === 'string') ||
      typeof obj.exp !== 'number' ||
      !Number.isFinite(obj.exp) ||
      typeof obj.jti !== 'string' ||
      obj.jti.length === 0
    ) {
      return null;
    }

    const now = nowSeconds ?? Math.floor(Date.now() / 1000);
    if (now >= obj.exp) {
      return null;
    }
    if (this.revoked.has(obj.jti)) {
      return null;
    }

    return {
      roots: obj.roots,
      exp: obj.exp,
      jti: obj.jti,
    };
  }

  /** Revoke a token by its `jti`. */
  revoke(jti: string): void {
    if (jti) {
      this.revoked.add(jti);
    }
  }

  /** Whether `jti` has been revoked. */
  isRevoked(jti: string): boolean {
    return this.revoked.has(jti);
  }
}
