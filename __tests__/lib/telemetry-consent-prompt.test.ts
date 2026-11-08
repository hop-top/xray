/**
 * The first-run consent prompt must always settle: an answer, end of input
 * (Ctrl-D, a closed terminal) and silence (an agent or hook on a pty) each
 * end it. An unanswered prompt is never persisted, so a later run asks again.
 */
import { PassThrough } from 'stream';
import { promptForConsent } from '../../src/lib/telemetry-consent';

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

  it('settles with no answer when input ends unanswered', async () => {
    const s = io(60_000);
    const p = promptForConsent(s);
    s.input.end();
    expect(await settled(p)).toBeUndefined();
  });

  it('settles with no answer when input stays silent and never closes', async () => {
    const s = io(100);
    expect(await settled(promptForConsent(s))).toBeUndefined();
    s.input.destroy();
  });
});
