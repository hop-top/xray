// Preloaded with `node --require` into the built CLI: replaces fetch so the
// upgrade check never reaches the network. Behaviour comes from env:
//   STUB_DELAY_MS  per-request latency (default 0)
//   STUB_PAGES     pages served; every page but the last is full (100 other
//                  components' releases), the last carries the xray release
//   STUB_TAG       tag on the last page (default xray/v99.0.0-rc.1)
//   STUB_HANG      '1': requests never answer
//   STUB_FAIL      'reject': fetch rejects (network down); 'http': HTTP 500
const delay = Number(process.env.STUB_DELAY_MS || 0);
const pages = Number(process.env.STUB_PAGES || 1);
const tag = process.env.STUB_TAG || 'xray/v99.0.0-rc.1';
globalThis.fetch = (url) => {
  const u = String(url);
  if (!u.startsWith('https://api.github.com/repos/hop-top/xray/releases')) {
    return Promise.reject(new Error(`stub fetch: unexpected URL ${u}`));
  }
  if (process.env.STUB_FAIL === 'reject') return Promise.reject(new Error('stub fetch: network down'));
  if (process.env.STUB_FAIL === 'http') return Promise.resolve({ ok: false, status: 500, json: async () => ({}) });
  if (process.env.STUB_HANG === '1') return new Promise(() => setInterval(() => {}, 1000));
  const page = Number(new URL(u).searchParams.get('page') || 1);
  const body =
    page < pages
      ? Array.from({ length: 100 }, (_, i) => ({ tag_name: `kit/v0.0.${i}`, prerelease: false }))
      : [{ tag_name: tag, prerelease: true, draft: false }];
  return new Promise((resolve) =>
    setTimeout(() => resolve({ ok: true, status: 200, json: async () => body }), delay),
  );
};
