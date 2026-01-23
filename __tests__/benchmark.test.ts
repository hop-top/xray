import { MetricsCollector } from '../src/benchmark/instrumentation/metrics-collector';
import { calculateCost, categorizeToolCall, generateRunId } from '../src/benchmark/utils';
import { CsvRecorder } from '../src/benchmark/recorder';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

describe('Benchmark Utils', () => {
  describe('calculateCost', () => {
    it('should calculate cost for Claude 3.5 Sonnet', () => {
      const cost = calculateCost('claude-3.5-sonnet', 1000, 500);
      expect(cost).toBeCloseTo(0.0105);
    });

    it('should calculate cost for Claude 3 Haiku', () => {
      const cost = calculateCost('claude-3-haiku', 1000, 500);
      expect(cost).toBeCloseTo(0.000875);
    });

    it('should default to Claude 3.5 Sonnet for unknown model', () => {
      const cost = calculateCost('unknown-model', 1000, 500);
      expect(cost).toBeCloseTo(0.0105);
    });
  });

  describe('categorizeToolCall', () => {
    it('should categorize read operations', () => {
      expect(categorizeToolCall('read')).toBe('read');
      expect(categorizeToolCall('cat')).toBe('read');
      expect(categorizeToolCall('head')).toBe('read');
      expect(categorizeToolCall('tail')).toBe('read');
    });

    it('should categorize write operations', () => {
      expect(categorizeToolCall('write')).toBe('write');
      expect(categorizeToolCall('edit')).toBe('write');
      expect(categorizeToolCall('create')).toBe('write');
    });

    it('should categorize search operations', () => {
      expect(categorizeToolCall('grep')).toBe('search');
      expect(categorizeToolCall('rg')).toBe('search');
      expect(categorizeToolCall('glob')).toBe('search');
    });

    it('should categorize other operations', () => {
      expect(categorizeToolCall('bash')).toBe('other');
      expect(categorizeToolCall('run')).toBe('other');
      expect(categorizeToolCall('unknown')).toBe('other');
    });
  });

  describe('generateRunId', () => {
    it('should generate unique run IDs', () => {
      const id1 = generateRunId();
      const id2 = generateRunId();
      
      expect(id1).toMatch(/^run_\d+_[a-z0-9]+$/);
      expect(id2).toMatch(/^run_\d+_[a-z0-9]+$/);
      expect(id1).not.toBe(id2);
    });
  });
});

describe('MetricsCollector', () => {
  let collector: MetricsCollector;
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'benchmark-test-'));
    collector = new MetricsCollector({
      config: 'baseline',
      repo: '/test/repo',
      assignment: 'Test task',
      agent: 'claude-3.5-sonnet',
      maxTurns: 10
    });
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('should start and record turns', () => {
    collector.start();
    
    collector.recordTurn({
      turnNumber: 1,
      toolCalls: [
        { name: 'read', input: {}, output: {}, duration: 100 }
      ],
      tokens: { input: 1000, output: 500 },
      cost: 0.01,
      duration: 500
    });

    expect(collector.getTurnCount()).toBe(1);
  });

  it('should calculate aggregated metrics', () => {
    collector.start();
    
    collector.recordTurn({
      turnNumber: 1,
      toolCalls: [
        { name: 'read', input: {}, output: {}, duration: 100 },
        { name: 'write', input: {}, output: {}, duration: 50 }
      ],
      tokens: { input: 1000, output: 500 },
      cost: 0.01,
      duration: 500
    });

    collector.recordTurn({
      turnNumber: 2,
      toolCalls: [
        { name: 'grep', input: {}, output: {}, duration: 200 }
      ],
      tokens: { input: 500, output: 300 },
      cost: 0.005,
      duration: 300
    });

    const metrics = collector.getMetrics();
    
    expect(metrics.totalToolCalls).toBe(3);
    expect(metrics.toolCallsByType.read).toBe(1);
    expect(metrics.toolCallsByType.write).toBe(1);
    expect(metrics.toolCallsByType.search).toBe(1);
    expect(metrics.totalTokens).toBe(2300);
    expect(metrics.turns.length).toBe(2);
  });
});

describe('CsvRecorder', () => {
  let recorder: CsvRecorder;
  let tempFile: string;

  beforeEach(() => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'benchmark-test-'));
    tempFile = path.join(tempDir, 'test-benchmarks.csv');
    recorder = new CsvRecorder(tempFile);
  });

  afterEach(() => {
    fs.rmSync(path.dirname(tempFile), { recursive: true, force: true });
  });

  it('should create CSV with headers on first write', () => {
    const metrics = {
      runId: 'test_run',
      timestamp: '2024-01-01T00:00:00Z',
      repo: '/test/repo',
      assignment: 'Test task',
      agent: 'claude-3.5-sonnet',
      config: 'baseline' as const,
      maxTurns: 10,
      turns: [],
      totalToolCalls: 5,
      toolCallsByType: { read: 2, write: 1, search: 1, other: 1 },
      totalTokens: 1000,
      inputTokens: 700,
      outputTokens: 300,
      totalCost: 0.01,
      duration: 1000,
      xrayVersion: '0.0.1'
    };

    recorder.record(metrics);

    const content = fs.readFileSync(tempFile, 'utf-8');
    const lines = content.trim().split('\n');
    
    expect(lines.length).toBe(2);
    expect(lines[0]).toContain('run_id,timestamp,repo');
    expect(lines[1]).toContain('test_run');
  });

  it('should append to existing CSV', () => {
    const metrics1 = {
      runId: 'run_1',
      timestamp: '2024-01-01T00:00:00Z',
      repo: '/test/repo',
      assignment: 'Test task',
      agent: 'claude-3.5-sonnet',
      config: 'baseline' as const,
      maxTurns: 10,
      turns: [],
      totalToolCalls: 5,
      toolCallsByType: { read: 2, write: 1, search: 1, other: 1 },
      totalTokens: 1000,
      inputTokens: 700,
      outputTokens: 300,
      totalCost: 0.01,
      duration: 1000,
      xrayVersion: '0.0.1'
    };

    const metrics2 = {
      runId: 'run_2',
      timestamp: '2024-01-01T01:00:00Z',
      repo: '/test/repo',
      assignment: 'Test task',
      agent: 'claude-3.5-sonnet',
      config: 'xray' as const,
      maxTurns: 10,
      turns: [],
      totalToolCalls: 3,
      toolCallsByType: { read: 1, write: 0, search: 2, other: 0 },
      totalTokens: 600,
      inputTokens: 400,
      outputTokens: 200,
      totalCost: 0.006,
      duration: 500,
      xrayVersion: '0.0.1'
    };

    recorder.record(metrics1);
    recorder.record(metrics2);

    const rows = recorder.readAll();
    
    expect(rows.length).toBe(2);
    expect(rows[0].run_id).toBe('run_1');
    expect(rows[1].run_id).toBe('run_2');
  });

  it('should handle commas in values', () => {
    const metrics = {
      runId: 'test_run',
      timestamp: '2024-01-01T00:00:00Z',
      repo: '/test/repo',
      assignment: 'Test, task, with, commas',
      agent: 'claude-3.5-sonnet',
      config: 'baseline' as const,
      maxTurns: 10,
      turns: [],
      totalToolCalls: 5,
      toolCallsByType: { read: 2, write: 1, search: 1, other: 1 },
      totalTokens: 1000,
      inputTokens: 700,
      outputTokens: 300,
      totalCost: 0.01,
      duration: 1000,
      xrayVersion: '0.0.1'
    };

    recorder.record(metrics);

    const rows = recorder.readAll();
    
    expect(rows.length).toBe(1);
    expect(rows[0].assignment).toBe('Test, task, with, commas');
  });
});
