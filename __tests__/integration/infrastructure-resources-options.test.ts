import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const CLI_PATH = path.join(__dirname, '../../bin/cli.js');

const MAIN_TF = `resource "aws_instance" "web" {
  ami = "x"
}
resource "aws_s3_bucket" "b" {
  bucket = "b"
}
resource "google_storage_bucket" "g" {
  name = "g"
}
`;

const DEPLOYMENT = `apiVersion: apps/v1
kind: Deployment
metadata:
  name: nginx
spec:
  replicas: 3
`;

describe('infrastructure resources --type/--tool/--provider (built CLI)', () => {
  let root: string;
  let home: string;

  beforeAll(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'infra-opts-'));
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'infra-opts-home-'));
    fs.writeFileSync(path.join(root, 'main.tf'), MAIN_TF);
    fs.writeFileSync(path.join(root, 'deployment.yaml'), DEPLOYMENT);
  });

  afterAll(() => {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(home, { recursive: true, force: true });
  });

  const run = (...args: string[]) =>
    spawnSync('node', [CLI_PATH, 'infrastructure', 'resources', '--format', 'json', ...args], {
      cwd: root,
      env: {
        ...process.env,
        HOME: home,
        XDG_CONFIG_HOME: path.join(home, 'config'),
        XDG_CACHE_HOME: path.join(home, 'cache'),
        NO_COLOR: '1',
      },
      encoding: 'utf8',
    });

  const types = (args: string[]): { status: number | null; types: string[] } => {
    const r = run(...args);
    const out = r.stdout.slice(r.stdout.indexOf('['));
    return {
      status: r.status,
      types: (JSON.parse(out) as { type: string }[]).map(x => x.type).sort(),
    };
  };

  it('unfiltered lists every resource', () => {
    expect(types([]).types).toEqual(
      ['Deployment', 'aws_instance', 'aws_s3_bucket', 'google_storage_bucket']
    );
  });

  it('--type filters by exact resource type', () => {
    expect(types(['--type', 'aws_instance'])).toEqual({ status: 0, types: ['aws_instance'] });
  });

  it('--tool filters by tool', () => {
    expect(types(['--tool', 'kubernetes'])).toEqual({ status: 0, types: ['Deployment'] });
    expect(types(['--tool', 'terraform']).types).toEqual(
      ['aws_instance', 'aws_s3_bucket', 'google_storage_bucket']
    );
  });

  it('--provider filters by cloud provider', () => {
    expect(types(['--provider', 'aws']).types).toEqual(['aws_instance', 'aws_s3_bucket']);
    expect(types(['--provider', 'google']).types).toEqual(['google_storage_bucket']);
  });

  it('combined filters intersect', () => {
    expect(types(['--tool', 'terraform', '--provider', 'aws', '--type', 'aws_s3_bucket']).types)
      .toEqual(['aws_s3_bucket']);
    expect(types(['--tool', 'kubernetes', '--provider', 'aws']).types).toEqual([]);
  });

  it('unmatched or unknown values give an empty result, exit 0', () => {
    expect(types(['--type', 'nope'])).toEqual({ status: 0, types: [] });
    expect(types(['--tool', 'pulumi'])).toEqual({ status: 0, types: [] });
    expect(types(['--provider', 'oracle'])).toEqual({ status: 0, types: [] });
  });

  it('text format prints the empty marker for an unmatched filter', () => {
    const r = spawnSync('node', [CLI_PATH, 'infrastructure', 'resources', '--type', 'nope'], {
      cwd: root,
      env: { ...process.env, HOME: home, XDG_CACHE_HOME: path.join(home, 'cache'), NO_COLOR: '1' },
      encoding: 'utf8',
    });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('(none found)');
  });
});
