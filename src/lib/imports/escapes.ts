/**
 * String-literal escape decoding for module strings. The languages differ
 * (Go has no `\'`, no line continuation and works in bytes; ECMAScript
 * takes any other escaped character as itself), so each has its own
 * decoder; the digit and code point helpers are shared. An escape the
 * language rejects makes the whole string undecodable (undefined): the
 * caller keeps the text as written, has no `normalized`, and reports it.
 * PHP's decoder lives with its extractor (its rules also pick the quote kind).
 */

const HEX = /^[0-9A-Fa-f]+$/;

/** Value of exactly `n` hex digits at `s[at..]`, or undefined. */
function hexAt(s: string, at: number, n: number): number | undefined {
  const digits = s.slice(at, at + n);
  return digits.length === n && HEX.test(digits) ? parseInt(digits, 16) : undefined;
}

const isSurrogate = (cp: number) => cp >= 0xd800 && cp <= 0xdfff;

const GO_SINGLE: Readonly<Record<string, number>> = { a: 7, b: 8, f: 12, n: 10, r: 13, t: 9, v: 11, '\\': 92, '"': 34 };

/**
 * Value of the body of a Go interpreted string literal (the text between
 * the quotes), per strconv.Unquote: `\a \b \f \n \r \t \v \\ \"`, `\ooo`
 * (three octal digits, at most 377), `\xHH`, `\uHHHH`, `\UHHHHHHHH` (a
 * Unicode scalar value). Escapes yield bytes, so `\xc3\xa9` is `é`; bytes
 * that are not UTF-8 make the string undecodable.
 */
export function decodeGoString(body: string): string | undefined {
  if (!body.includes('\\')) return body;
  const bytes: number[] = [];
  const text = new TextEncoder();
  for (let i = 0; i < body.length; ) {
    const c = body[i];
    if (c !== '\\') {
      const cp = body.codePointAt(i)!;
      const ch = String.fromCodePoint(cp);
      bytes.push(...text.encode(isSurrogate(cp) ? '�' : ch));
      i += ch.length;
      continue;
    }
    const e = body[i + 1];
    if (e === undefined) return undefined;
    if (GO_SINGLE[e] !== undefined) { bytes.push(GO_SINGLE[e]); i += 2; continue; }
    if (e >= '0' && e <= '7') {
      const v = /^[0-7]{3}$/.test(body.slice(i + 1, i + 4)) ? parseInt(body.slice(i + 1, i + 4), 8) : NaN;
      if (!(v <= 255)) return undefined;
      bytes.push(v);
      i += 4;
      continue;
    }
    if (e === 'x') {
      const v = hexAt(body, i + 2, 2);
      if (v === undefined) return undefined;
      bytes.push(v);
      i += 4;
      continue;
    }
    if (e === 'u' || e === 'U') {
      const n = e === 'u' ? 4 : 8;
      const cp = hexAt(body, i + 2, n);
      if (cp === undefined || cp > 0x10ffff || isSurrogate(cp)) return undefined;
      bytes.push(...text.encode(String.fromCodePoint(cp)));
      i += 2 + n;
      continue;
    }
    return undefined;
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(bytes));
  } catch {
    return undefined;
  }
}

const JS_SINGLE: Readonly<Record<string, string>> = { b: '\b', f: '\f', n: '\n', r: '\r', t: '\t', v: '\v' };

/**
 * Value of the body of an ECMAScript string or template literal (the text
 * between the delimiters): `\xHH`, `\uHHHH`, `\u{H+}` (at most 10FFFF),
 * `\0`, the single-character escapes, a line continuation (dropped), and
 * any other escaped character as itself. Legacy octal escapes (`\101`,
 * strings only) are decoded; in a template, and for malformed `\x` / `\u`,
 * the string is undecodable. A template's raw CRLF is not normalized here.
 */
export function decodeEcmaScriptString(body: string, template = false): string | undefined {
  if (!body.includes('\\')) return body;
  let out = '';
  for (let i = 0; i < body.length; ) {
    const c = body[i];
    if (c !== '\\') { out += c; i++; continue; }
    const e = body[i + 1];
    if (e === undefined) return undefined;
    if (JS_SINGLE[e] !== undefined) { out += JS_SINGLE[e]; i += 2; continue; }
    if (e === '\r') { i += body[i + 2] === '\n' ? 3 : 2; continue; }
    if (e === '\n' || e === ' ' || e === ' ') { i += 2; continue; }
    if (e === 'x') {
      const v = hexAt(body, i + 2, 2);
      if (v === undefined) return undefined;
      out += String.fromCharCode(v);
      i += 4;
      continue;
    }
    if (e === 'u') {
      if (body[i + 2] === '{') {
        const close = body.indexOf('}', i + 3);
        const digits = close < 0 ? '' : body.slice(i + 3, close);
        if (!HEX.test(digits)) return undefined;
        const cp = parseInt(digits, 16); // a huge run parses to Infinity, also rejected
        if (!(cp <= 0x10ffff)) return undefined;
        out += String.fromCodePoint(cp);
        i = close + 1;
        continue;
      }
      const v = hexAt(body, i + 2, 4);
      if (v === undefined) return undefined;
      out += String.fromCharCode(v);
      i += 6;
      continue;
    }
    if (e >= '0' && e <= '9') {
      if (e === '0' && !(body[i + 2] >= '0' && body[i + 2] <= '9')) { out += '\0'; i += 2; continue; }
      if (template) return undefined;
      if (e >= '8') { out += e; i += 2; continue; }
      // Legacy octal: up to three digits, value at most 377.
      const m = (e <= '3' ? /^[0-7]{1,3}/ : /^[0-7]{1,2}/).exec(body.slice(i + 1, i + 4))!;
      out += String.fromCharCode(parseInt(m[0], 8));
      i += 1 + m[0].length;
      continue;
    }
    const cp = body.codePointAt(i + 1)!;
    const ch = String.fromCodePoint(cp);
    out += ch;
    i += 1 + ch.length;
  }
  return out;
}
