/**
 * The first-run consent prompt must always settle: an answer, end of input
 * (Ctrl-D, a closed terminal) and silence (an agent or hook on a pty) each
 * end it. No answer (end of input, timeout) means telemetry off.
 */
import { PassThrough } from 'stream';
import { CONSENT_PROMPT_TIMEOUT_MS, promptForConsent } from '../../src/lib/telemetry-consent';

// kit tui pulls ESM-only deps jest cannot load; styling is irrelevant here
jest.mock('../../src/lib/tui', () => {
  const id = (t: string) => t;
  return {
    styles: () => ({ bold: id, accent: id, muted: id, warn: id }),
    statusLine: (t: string) => t,
  };
});

function io(timeoutMs?: number) {
  const input = new PassThrough();
  const output = new PassThrough();
  output.resume();
  return { input, output, timeoutMs };
}

/** Settles with 'hung' if the prompt has not settled within `ms`. */
function settled<T>(p: Promise<T>, ms = 1500): Promise<T | 'hung'> {
  let t: NodeJS.Timeout;
  return Promise.race([
    p,
    new Promise<'hung'>(res => { t = setTimeout(() => res('hung'), ms); }),
  ]).finally(() => clearTimeout(t));
}

describe('promptForConsent', () => {
  it('returns the answer', async () => {
    const s = io(5000);
    const p = promptForConsent(s);
    s.input.write('n\n');
    expect(await settled(p)).toBe(false);
    const s2 = io(5000);
    const p2 = promptForConsent(s2);
    s2.input.write('\n');
    expect(await settled(p2)).toBe(true);
  });

  it('times out after 15 seconds by default', () => {
    expect(CONSENT_PROMPT_TIMEOUT_MS).toBe(15_000);
  });

  it('declines when input ends unanswered (Ctrl-D)', async () => {
    const s = io(60_000);
    const p = promptForConsent(s);
    s.input.end();
    expect(await settled(p)).toBe(false);
  });

  it('declines when input stays silent and never closes', async () => {
    const s = io(100);
    expect(await settled(promptForConsent(s))).toBe(false);
    s.input.destroy();
  });

  it('says how to change the choice later', async () => {
    const s = io(5000);
    let text = '';
    s.output.on('data', (d: Buffer) => { text += d.toString(); });
    const p = promptForConsent(s);
    s.input.write('n\n');
    await settled(p);
    expect(text).toContain('XRAY_TELEMETRY_ENABLED');
    expect(text).toContain('xray paths');
  });
});
