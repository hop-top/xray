import ExpressStrategy from '../../strategies/express';
import RestApiStrategy from '../../strategies/rest-api';

const ctxOf = (content: string): any => ({ readFile: async () => content });

describe('express strategy on repo-controlled source', () => {
  const strategy = new ExpressStrategy();

  it('still reads real Express code', async () => {
    const src = `
const app = express();
const apiRouter = express.Router();
app.use(cors());
server.app.use(helmet);
$app.use('/static', serveStatic);
app.use('/api', apiRouter);
app.get('/ok', handler);
this.router.post('/x', auth, handler);
function onError(err, req, res, next) {}
app.use(onError);
app.use((err, req, res, next) => {});
`;
    const m = await strategy.analyze('a.js', ctxOf(src));
    expect(m.metadata!.routes.map((r: any) => `${r.method} ${r.path}`)).toEqual(['GET /ok', 'POST /x']);
    expect(m.metadata!.routerMounts.map((x: any) => x.path)).toEqual(['/static', '/api']);
    expect(m.metadata!.middleware.map((x: any) => x.name)).toEqual(
      expect.arrayContaining(['cors()', 'helmet', 'serveStatic']),
    );
    expect(m.metadata!.errorHandlers).toEqual(
      expect.arrayContaining([{ name: 'onError', type: 'named' }, { type: 'inline' }]),
    );
  });

  it('a long identifier run does not blow up (was quadratic)', async () => {
    const t = Date.now();
    await strategy.analyze('a.js', ctxOf('a'.repeat(100_000)));
    expect(Date.now() - t).toBeLessThan(1000);
  });

  it('repeated unclosed use( calls do not blow up (unbounded argument scan)', async () => {
    const t = Date.now();
    await strategy.analyze('a.js', ctxOf('a.use('.repeat(2_000)));
    expect(Date.now() - t).toBeLessThan(1000);
  });

  it('many named handlers cost one pass, not one scan each', async () => {
    let src = 'app.use(h0);\napp.use(h19999);\n';
    for (let i = 0; i < 20_000; i++) src += `function h${i}(err, req, res, next) {}\n`;
    const t = Date.now();
    const m = await strategy.analyze('a.js', ctxOf(src));
    expect(Date.now() - t).toBeLessThan(1000);
    expect(m.metadata!.errorHandlers).toEqual([
      { name: 'h0', type: 'named' },
      { name: 'h19999', type: 'named' },
    ]);
  });

  it('a long identifier run does not blow up in rest-api either', async () => {
    const t = Date.now();
    await new RestApiStrategy().analyze('a.js', ctxOf('a'.repeat(100_000)));
    await new RestApiStrategy().analyze('a.go', ctxOf('a'.repeat(100_000)));
    expect(Date.now() - t).toBeLessThan(1000);
  });
});
