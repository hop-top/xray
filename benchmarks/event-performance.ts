/**
 * Performance Benchmarks for Event System
 *
 * Benchmarks:
 * 1. Sequential vs Parallel emission
 * 2. Overhead with/without listeners
 * 3. Large codebase performance (1000+ files)
 *
 * Run with: npx tsx benchmarks/event-performance.ts
 */

import { AsyncEventEmitter } from '../src/lib/events/async-emitter';
import { Xray } from '../src/lib/xray';
import { XrayPlugin } from '../src/lib/events/plugin';
import fs from 'fs';
import path from 'path';

interface BenchmarkResult {
  name: string;
  iterations: number;
  totalMs: number;
  avgMs: number;
  minMs: number;
  maxMs: number;
  opsPerSec: number;
}

class BenchmarkRunner {
  private results: BenchmarkResult[] = [];

  async run(name: string, iterations: number, fn: () => Promise<void>): Promise<BenchmarkResult> {
    console.log(`\n📊 Running: ${name} (${iterations} iterations)`);

    const times: number[] = [];

    // Warmup
    await fn();

    // Benchmark
    for (let i = 0; i < iterations; i++) {
      const start = performance.now();
      await fn();
      const end = performance.now();
      times.push(end - start);

      if ((i + 1) % 10 === 0) {
        process.stdout.write(`\r  Progress: ${i + 1}/${iterations}`);
      }
    }

    console.log(); // New line after progress

    const totalMs = times.reduce((a, b) => a + b, 0);
    const avgMs = totalMs / iterations;
    const minMs = Math.min(...times);
    const maxMs = Math.max(...times);
    const opsPerSec = 1000 / avgMs;

    const result: BenchmarkResult = {
      name,
      iterations,
      totalMs,
      avgMs,
      minMs,
      maxMs,
      opsPerSec
    };

    this.results.push(result);

    console.log(`  ✓ Avg: ${avgMs.toFixed(3)}ms | Min: ${minMs.toFixed(3)}ms | Max: ${maxMs.toFixed(3)}ms | ${opsPerSec.toFixed(0)} ops/sec`);

    return result;
  }

  printSummary() {
    console.log('\n' + '='.repeat(80));
    console.log('BENCHMARK SUMMARY');
    console.log('='.repeat(80));
    console.log();

    for (const result of this.results) {
      console.log(`${result.name}:`);
      console.log(`  Average: ${result.avgMs.toFixed(3)}ms`);
      console.log(`  Min/Max: ${result.minMs.toFixed(3)}ms / ${result.maxMs.toFixed(3)}ms`);
      console.log(`  Throughput: ${result.opsPerSec.toFixed(0)} ops/sec`);
      console.log();
    }
  }

  saveResults(outputPath: string) {
    const report = {
      timestamp: new Date().toISOString(),
      results: this.results,
      summary: {
        totalBenchmarks: this.results.length,
        totalIterations: this.results.reduce((sum, r) => sum + r.iterations, 0)
      }
    };

    fs.writeFileSync(outputPath, JSON.stringify(report, null, 2));
    console.log(`\n📝 Results saved to: ${outputPath}`);
  }
}

// Benchmark 1: Sequential vs Parallel Emission
async function benchmarkEmissionModes() {
  console.log('\n' + '='.repeat(80));
  console.log('BENCHMARK 1: Sequential vs Parallel Emission');
  console.log('='.repeat(80));

  const runner = new BenchmarkRunner();

  interface TestEvents {
    'test:event': { value: number };
  }

  // Sequential emission with multiple listeners
  await runner.run('Sequential emission (5 listeners)', 100, async () => {
    const emitter = new AsyncEventEmitter<TestEvents>();

    for (let i = 0; i < 5; i++) {
      emitter.on('test:event', async (event) => {
        await new Promise(resolve => setTimeout(resolve, 1));
        event.value += 1;
      });
    }

    await emitter.emitAsync('test:event', { value: 0 });
  });

  // Parallel emission with multiple listeners
  await runner.run('Parallel emission (5 listeners)', 100, async () => {
    const emitter = new AsyncEventEmitter<TestEvents>();

    for (let i = 0; i < 5; i++) {
      emitter.on('test:event', async () => {
        await new Promise(resolve => setTimeout(resolve, 1));
      });
    }

    await emitter.emitAsyncParallel('test:event', { value: 0 });
  });

  // Sequential emission with many listeners
  await runner.run('Sequential emission (20 listeners)', 100, async () => {
    const emitter = new AsyncEventEmitter<TestEvents>();

    for (let i = 0; i < 20; i++) {
      emitter.on('test:event', async (event) => {
        event.value += 1;
      });
    }

    await emitter.emitAsync('test:event', { value: 0 });
  });

  // Parallel emission with many listeners
  await runner.run('Parallel emission (20 listeners)', 100, async () => {
    const emitter = new AsyncEventEmitter<TestEvents>();

    for (let i = 0; i < 20; i++) {
      emitter.on('test:event', async () => {
        // No-op
      });
    }

    await emitter.emitAsyncParallel('test:event', { value: 0 });
  });

  runner.printSummary();

  return runner.results;
}

// Benchmark 2: Overhead with/without Listeners
async function benchmarkListenerOverhead() {
  console.log('\n' + '='.repeat(80));
  console.log('BENCHMARK 2: Listener Overhead');
  console.log('='.repeat(80));

  const runner = new BenchmarkRunner();
  const testDir = path.join(__dirname, '../__tests__/fixtures/benchmark-overhead');

  // Setup test files
  if (!fs.existsSync(testDir)) {
    fs.mkdirSync(testDir, { recursive: true });
  }

  for (let i = 0; i < 10; i++) {
    fs.writeFileSync(
      path.join(testDir, `file${i}.ts`),
      `export function func${i}() { return ${i}; }`
    );
  }

  try {
    // Baseline: No listeners
    await runner.run('Xray with 0 listeners', 10, async () => {
      const xray = new Xray({
        path: testDir,
        cachePath: ':memory:',
        chunked: false
      });
      await xray.run();
    });

    // 1 listener (no-op)
    await runner.run('Xray with 1 listener', 10, async () => {
      const xray = new Xray({
        path: testDir,
        cachePath: ':memory:',
        chunked: false
      });

      xray.on('parse:after', () => {});

      await xray.run();
    });

    // 5 listeners (no-op)
    await runner.run('Xray with 5 listeners', 10, async () => {
      const xray = new Xray({
        path: testDir,
        cachePath: ':memory:',
        chunked: false
      });

      for (let i = 0; i < 5; i++) {
        xray.on('parse:after', () => {});
      }

      await xray.run();
    });

    // 10 listeners (no-op)
    await runner.run('Xray with 10 listeners', 10, async () => {
      const xray = new Xray({
        path: testDir,
        cachePath: ':memory:',
        chunked: false
      });

      for (let i = 0; i < 10; i++) {
        xray.on('parse:after', () => {});
      }

      await xray.run();
    });

    // 10 listeners (with work)
    await runner.run('Xray with 10 active listeners', 10, async () => {
      const xray = new Xray({
        path: testDir,
        cachePath: ':memory:',
        chunked: false
      });

      for (let i = 0; i < 10; i++) {
        xray.on('parse:after', (event) => {
          event.tags = event.tags.filter(tag => tag.name.length > 0);
        });
      }

      await xray.run();
    });

  } finally {
    // Cleanup
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  }

  runner.printSummary();

  return runner.results;
}

// Benchmark 3: Large Codebase Performance
async function benchmarkLargeCodebase() {
  console.log('\n' + '='.repeat(80));
  console.log('BENCHMARK 3: Large Codebase (1000+ files)');
  console.log('='.repeat(80));

  const runner = new BenchmarkRunner();
  const testDir = path.join(__dirname, '../__tests__/fixtures/benchmark-large');

  console.log('\n📁 Generating 1000 test files...');

  // Setup large test directory
  if (!fs.existsSync(testDir)) {
    fs.mkdirSync(testDir, { recursive: true });
  }

  // Generate 1000 files in subdirectories
  for (let i = 0; i < 1000; i++) {
    const subdir = path.join(testDir, `module${Math.floor(i / 100)}`);
    if (!fs.existsSync(subdir)) {
      fs.mkdirSync(subdir, { recursive: true });
    }

    fs.writeFileSync(
      path.join(subdir, `file${i}.ts`),
      `
export function func${i}() {
  return ${i};
}

export const CONSTANT${i} = ${i};

export class Class${i} {
  method() {
    return ${i};
  }
}
      `.trim()
    );

    if ((i + 1) % 100 === 0) {
      process.stdout.write(`\r  Generated: ${i + 1}/1000 files`);
    }
  }

  console.log('\n\n📊 Running benchmarks on large codebase...');

  try {
    // Without plugins
    await runner.run('Large codebase (no plugins)', 3, async () => {
      const xray = new Xray({
        path: testDir,
        cachePath: ':memory:',
        chunked: false
      });
      await xray.run();
    });

    // With filter plugin
    await runner.run('Large codebase (with filter plugin)', 3, async () => {
      class FilterPlugin implements XrayPlugin {
        name = 'filter';
        apply(xray: Xray): void {
          xray.on('parse:after', (event) => {
            event.tags = event.tags.filter(tag => tag.kind === 'function');
          });
        }
      }

      const xray = new Xray({
        path: testDir,
        cachePath: ':memory:',
        chunked: false
      });

      await xray.use(new FilterPlugin());
      await xray.run();
    });

    // With multiple plugins
    await runner.run('Large codebase (with 3 plugins)', 3, async () => {
      class Plugin1 implements XrayPlugin {
        name = 'plugin1';
        apply(xray: Xray): void {
          xray.on('scan:complete', () => {});
        }
      }

      class Plugin2 implements XrayPlugin {
        name = 'plugin2';
        apply(xray: Xray): void {
          xray.on('parse:after', (event) => {
            event.tags = event.tags.filter(tag => !tag.name.startsWith('_'));
          });
        }
      }

      class Plugin3 implements XrayPlugin {
        name = 'plugin3';
        apply(xray: Xray): void {
          xray.on('graph:complete', () => {});
        }
      }

      const xray = new Xray({
        path: testDir,
        cachePath: ':memory:',
        chunked: false
      });

      await xray.use(new Plugin1());
      await xray.use(new Plugin2());
      await xray.use(new Plugin3());
      await xray.run();
    });

  } finally {
    // Cleanup
    console.log('\n\n🧹 Cleaning up test files...');
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  }

  runner.printSummary();

  return runner.results;
}

// Main benchmark suite
async function main() {
  console.log('╔' + '═'.repeat(78) + '╗');
  console.log('║' + ' '.repeat(20) + 'XRAY EVENT SYSTEM BENCHMARKS' + ' '.repeat(30) + '║');
  console.log('╚' + '═'.repeat(78) + '╝');

  const allResults: BenchmarkResult[] = [];

  // Run all benchmarks
  const results1 = await benchmarkEmissionModes();
  allResults.push(...results1);

  const results2 = await benchmarkListenerOverhead();
  allResults.push(...results2);

  const results3 = await benchmarkLargeCodebase();
  allResults.push(...results3);

  // Save combined results
  const outputPath = path.join(__dirname, 'event-performance-results.json');
  const report = {
    timestamp: new Date().toISOString(),
    benchmarks: {
      emissionModes: results1,
      listenerOverhead: results2,
      largeCodebase: results3
    },
    summary: {
      totalBenchmarks: allResults.length,
      totalTime: allResults.reduce((sum, r) => sum + r.totalMs, 0),
      avgOverheadPerListener: calculateOverhead(results2)
    }
  };

  fs.writeFileSync(outputPath, JSON.stringify(report, null, 2));

  console.log('\n' + '='.repeat(80));
  console.log('FINAL SUMMARY');
  console.log('='.repeat(80));
  console.log();
  console.log(`Total benchmarks run: ${allResults.length}`);
  console.log(`Total time: ${(allResults.reduce((sum, r) => sum + r.totalMs, 0) / 1000).toFixed(2)}s`);
  console.log();

  // Performance impact analysis
  console.log('KEY FINDINGS:');
  console.log();

  // Sequential vs Parallel
  const seq5 = results1.find(r => r.name.includes('Sequential emission (5'));
  const par5 = results1.find(r => r.name.includes('Parallel emission (5'));
  if (seq5 && par5) {
    const speedup = seq5.avgMs / par5.avgMs;
    console.log(`• Parallel emission is ${speedup.toFixed(2)}x faster than sequential (5 listeners with delays)`);
  }

  // Listener overhead
  const overhead = calculateOverhead(results2);
  if (overhead !== null) {
    console.log(`• Average overhead per listener: ~${overhead.toFixed(3)}ms`);
  }

  // Large codebase
  const large = results3.find(r => r.name.includes('no plugins'));
  if (large) {
    const filesPerSec = 1000 / (large.avgMs / 1000);
    console.log(`• Large codebase (1000 files) processing rate: ${filesPerSec.toFixed(0)} files/sec`);
  }

  console.log();
  console.log(`📝 Detailed results saved to: ${outputPath}`);
  console.log();
}

function calculateOverhead(results: BenchmarkResult[]): number | null {
  const baseline = results.find(r => r.name.includes('0 listeners'));
  const with1 = results.find(r => r.name.includes('1 listener'));
  const with5 = results.find(r => r.name.includes('5 listeners'));
  const with10 = results.find(r => r.name.includes('10 listeners') && !r.name.includes('active'));

  if (!baseline || !with1 || !with5 || !with10) return null;

  // Calculate overhead per listener
  const overhead1 = (with1.avgMs - baseline.avgMs) / 1;
  const overhead5 = (with5.avgMs - baseline.avgMs) / 5;
  const overhead10 = (with10.avgMs - baseline.avgMs) / 10;

  return (overhead1 + overhead5 + overhead10) / 3;
}

// Run benchmarks
main().catch(console.error);
