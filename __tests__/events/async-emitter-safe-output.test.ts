import { AsyncEventEmitter } from '../../src/lib/events/async-emitter';

const EVIL = '\x1b[2J\x1b]0;pwned\x07boom\rX';

describe('AsyncEventEmitter fallback output is terminal-safe', () => {
  let spies: jest.SpyInstance[];
  let lines: string[];

  beforeEach(() => {
    lines = [];
    const grab = (...a: any[]) => { lines.push(a.map(String).join(' ')); };
    spies = [
      jest.spyOn(console, 'error').mockImplementation(grab),
      jest.spyOn(console, 'warn').mockImplementation(grab),
    ];
  });
  afterEach(() => spies.forEach(s => s.mockRestore()));

  const expectSafe = () => {
    expect(lines.length).toBeGreaterThan(0);
    const out = lines.join('\n');
    expect(out).not.toContain('\x1b[2J');
    expect(out).not.toContain('\x07');
    expect(out).not.toContain('\r');
    expect(out).toContain('boom');
  };

  it('sync throw inside an error listener', async () => {
    const e = new AsyncEventEmitter<any>();
    e.on('x', async () => { throw new Error('first'); });
    e.on('error', () => { throw new Error(EVIL); });
    await e.emitAsync('x', {});
    expectSafe();
  });

  it('async rejection inside an error listener', async () => {
    const e = new AsyncEventEmitter<any>();
    e.on('x', async () => { throw new Error('first'); });
    e.on('error', async () => { throw new Error(EVIL); });
    await e.emitAsync('x', {});
    await new Promise(r => setImmediate(r));
    expectSafe();
  });

  it('error emitted as an error-event listener failure', async () => {
    const e = new AsyncEventEmitter<any>();
    e.on('error', async () => { throw new Error(EVIL); });
    await e.emitAsync('error', {});
    expectSafe();
  });
});
