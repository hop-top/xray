/**
 * Repo-controlled text (file names, source lines, headings, config values)
 * must not reach a terminal carrying control sequences: ESC can clear the
 * screen or set the title, CR can overwrite a line, a newline inside one
 * field can forge a whole line. Escape such text in the data, before any
 * styling, so xray's own colors still work.
 *
 * Escaped: C0 controls, DEL and C1 controls (U+0080-U+009F, which include
 * the 8-bit CSI, U+009B). `\n`, `\r` and `\t` read as those two characters;
 * the rest as `\xNN`. Backslashes are left alone: normal text stays
 * byte-identical.
 *
 * Tab is the one control kept, because it cannot move the cursor off the
 * line, rewrite output or open a sequence.
 */

// eslint-disable-next-line no-control-regex
const FIELD = /[\u0000-\u0008\u000a-\u001f\u007f-\u009f]/g;
// eslint-disable-next-line no-control-regex
const BLOCK = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g; // keeps \n and \t; \r is escaped

const NAMED: Record<string, string> = { '\n': '\\n', '\r': '\\r' };

const escapeOne = (c: string): string =>
  NAMED[c] ?? `\\x${c.charCodeAt(0).toString(16).padStart(2, '0')}`;

/** One field (a path, a name, a source line): every control but tab is escaped, newline included. */
export function terminalSafe(s: string): string {
  return s.replace(FIELD, escapeOne);
}

/**
 * A multi-line block that is meant to span lines (pretty JSON, a rendered
 * document): newlines and tabs stay, everything else is escaped.
 */
export function terminalSafeBlock(s: string): string {
  return s.replace(BLOCK, escapeOne);
}
