// tests/integration/config-strategy.test.ts
// Note: execSync is used in controlled test environment (safe as per plan)
import { execSync } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

const CLI_PATH = path.join(__dirname, '../../bin/cli.js');

describe('Config Files Strategy Integration', () => {
  let testRoot: string;

  beforeAll(() => {
    // Create comprehensive config test project
    testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'config-integration-'));

    // Create package.json to establish project root
    fs.writeFileSync(
      path.join(testRoot, 'package.json'),
      JSON.stringify({
        name: 'test-config-integration',
        version: '1.0.0',
        dependencies: {
          express: '^4.0.0'
        }
      }, null, 2)
    );

    // Create .env file
    fs.writeFileSync(
      path.join(testRoot, '.env'),
      `# Application Configuration
NODE_ENV=development
PORT=3000
DATABASE_URL=postgresql://localhost:5432/mydb
API_KEY=secret-key-123
DEBUG=true
MAX_CONNECTIONS=100
`
    );

    // Create .env.local file
    fs.writeFileSync(
      path.join(testRoot, '.env.local'),
      `NODE_ENV=local
PORT=3001
LOCAL_STORAGE_PATH=/tmp/storage
`
    );

    // Create .env.production file
    fs.writeFileSync(
      path.join(testRoot, '.env.production'),
      `NODE_ENV=production
PORT=8080
DATABASE_URL=postgresql://prod-server:5432/proddb
`
    );

    // Create JSON config file
    fs.writeFileSync(
      path.join(testRoot, 'config.json'),
      JSON.stringify({
        app: {
          name: 'test-app',
          version: '1.0.0',
          port: 3000
        },
        database: {
          host: 'localhost',
          port: 5432,
          name: 'mydb'
        },
        features: {
          authentication: true,
          logging: true,
          caching: false
        }
      }, null, 2)
    );

    // Create another JSON config
    fs.writeFileSync(
      path.join(testRoot, 'server.config.json'),
      JSON.stringify({
        server: {
          host: '0.0.0.0',
          port: 8080,
          ssl: {
            enabled: true,
            cert: '/path/to/cert.pem',
            key: '/path/to/key.pem'
          }
        },
        middleware: ['cors', 'helmet', 'compression']
      }, null, 2)
    );

    // Create YAML config file
    fs.writeFileSync(
      path.join(testRoot, 'config.yml'),
      `application:
  name: test-app
  environment: development
  debug: true

database:
  primary:
    host: localhost
    port: 5432
    database: mydb
    pool:
      min: 2
      max: 10

  replica:
    host: replica.localhost
    port: 5433
    database: mydb

cache:
  enabled: true
  ttl: 3600
  provider: redis
`
    );

    // Create another YAML config
    fs.writeFileSync(
      path.join(testRoot, 'docker-compose.yaml'),
      `version: '3.8'

services:
  web:
    image: nginx:latest
    ports:
      - "80:80"
      - "443:443"
    environment:
      - NGINX_HOST=localhost
      - NGINX_PORT=80
    volumes:
      - ./nginx.conf:/etc/nginx/nginx.conf:ro

  db:
    image: postgres:14
    ports:
      - "5432:5432"
    environment:
      POSTGRES_DB: mydb
      POSTGRES_USER: user
      POSTGRES_PASSWORD: password
`
    );

    // Create TOML config file
    fs.writeFileSync(
      path.join(testRoot, 'config.toml'),
      `title = "Configuration"

[owner]
name = "Test User"
organization = "Test Org"

[database]
server = "192.168.1.1"
ports = [ 8001, 8001, 8002 ]
connection_max = 5000
enabled = true

[servers]
  [servers.alpha]
  ip = "10.0.0.1"
  dc = "eqdc10"

  [servers.beta]
  ip = "10.0.0.2"
  dc = "eqdc10"

[clients]
data = [ ["gamma", "delta"], [1, 2] ]
hosts = [
  "alpha",
  "omega"
]
`
    );

    // Create a config subdirectory with more configs
    fs.mkdirSync(path.join(testRoot, 'config'), { recursive: true });

    fs.writeFileSync(
      path.join(testRoot, 'config', 'database.json'),
      JSON.stringify({
        production: {
          host: 'prod.db.com',
          port: 5432
        },
        staging: {
          host: 'staging.db.com',
          port: 5432
        }
      }, null, 2)
    );
  });

  afterAll(() => {
    // Cleanup
    if (fs.existsSync(testRoot)) {
      fs.rmSync(testRoot, { recursive: true, force: true });
    }
  });

  describe('Strategy Detection', () => {
    it('should detect config files strategy', () => {
      const output = execSync(`node ${CLI_PATH} strategy detect -p ${testRoot} 2>&1`).toString();

      expect(output).toContain('Detected Strategies:');
      expect(output).toContain('config-files');
    });

    it('should list config as available strategy', () => {
      const output = execSync(`node ${CLI_PATH} strategy list 2>&1`).toString();

      expect(output).toContain('Available Strategies:');
      expect(output).toContain('config-files');
    });
  });

  describe('Config Files Listing', () => {
    it('should find all config files', () => {
      const output = execSync(`node ${CLI_PATH} config-files list -p ${testRoot}`).toString();

      expect(output).toContain('Configuration Files:');

      // .env files
      expect(output).toContain('.env');
      expect(output).toContain('.env.local');
      expect(output).toContain('.env.production');

      // JSON files
      expect(output).toContain('config.json');
      expect(output).toContain('server.config.json');
      expect(output).toContain('config/database.json');

      // YAML files
      expect(output).toContain('config.yml');
      expect(output).toContain('docker-compose.yaml');

      // TOML files
      expect(output).toContain('config.toml');
    });

    it('should print paths relative to the project root, not the cwd', () => {
      // CLI runs from the repo (cwd != testRoot); paths must not climb out of testRoot.
      const output = execSync(`node ${CLI_PATH} config-files list -p ${testRoot}`).toString();
      expect(output).not.toContain('../');
      expect(output).toMatch(/^\s+config\/database\.json$/m);
    });

    it('should count config files correctly', () => {
      const output = execSync(`node ${CLI_PATH} config-files list -p ${testRoot}`).toString();

      // Should find 9 config files total
      expect(output).toMatch(/Total:\s*9\s*file\(s\)/);
    });

    it('should work with explore prefix', () => {
      const output = execSync(`node ${CLI_PATH} config-files list -p ${testRoot}`).toString();

      expect(output).toContain('Configuration Files:');
      expect(output).toMatch(/Total:\s*9\s*file\(s\)/);
    });
  });

  describe('Config Keys Extraction', () => {
    it('should extract keys from .env files', () => {
      const output = execSync(`node ${CLI_PATH} config-files keys -p ${testRoot} --file .env`).toString();

      expect(output).toContain('Configuration Keys');
      expect(output).toContain('NODE_ENV');
      expect(output).toContain('PORT');
      expect(output).toContain('DATABASE_URL');
      expect(output).toContain('API_KEY');
      expect(output).toContain('DEBUG');
      expect(output).toContain('MAX_CONNECTIONS');
    });

    it('should extract keys from JSON files', () => {
      const output = execSync(`node ${CLI_PATH} config-files keys -p ${testRoot} --file config.json`).toString();

      expect(output).toContain('Configuration Keys');
      expect(output).toContain('app.name');
      expect(output).toContain('app.version');
      expect(output).toContain('app.port');
      expect(output).toContain('database.host');
      expect(output).toContain('database.port');
      expect(output).toContain('database.name');
      expect(output).toContain('features.authentication');
      expect(output).toContain('features.logging');
      expect(output).toContain('features.caching');
    });

    it('should extract keys from YAML files', () => {
      const output = execSync(`node ${CLI_PATH} config-files keys -p ${testRoot} --file config.yml`).toString();

      expect(output).toContain('Configuration Keys');
      expect(output).toContain('application.name');
      expect(output).toContain('application.environment');
      expect(output).toContain('application.debug');
      expect(output).toContain('database.primary.host');
      expect(output).toContain('database.primary.port');
      expect(output).toContain('database.replica.host');
      expect(output).toContain('cache.enabled');
      expect(output).toContain('cache.ttl');
    });

    it('should extract keys from TOML files', () => {
      const output = execSync(`node ${CLI_PATH} config-files keys -p ${testRoot} --file config.toml`).toString();

      expect(output).toContain('Configuration Keys');
      expect(output).toContain('title');
      expect(output).toContain('owner.name');
      expect(output).toContain('owner.organization');
      expect(output).toContain('database.server');
      expect(output).toContain('database.enabled');
      expect(output).toContain('servers.alpha.ip');
      expect(output).toContain('servers.beta.ip');
    });

    it('should list all keys when no file specified', () => {
      const output = execSync(`node ${CLI_PATH} config-files keys -p ${testRoot}`).toString();

      // Should include keys from all config files
      expect(output).toContain('NODE_ENV');
      expect(output).toContain('app.name');
      expect(output).toContain('application.name');
      expect(output).toContain('owner.name');
    });
  });

  describe('Config Values Display', () => {
    it('should show values from .env files', () => {
      const output = execSync(`node ${CLI_PATH} config-files values -p ${testRoot} --file .env`).toString();

      expect(output).toContain('Configuration Values');
      expect(output).toContain('NODE_ENV');
      expect(output).toContain('development');
      expect(output).toContain('PORT');
      expect(output).toContain('3000');
      expect(output).toContain('DATABASE_URL');
      expect(output).toContain('postgresql://localhost:5432/mydb');
    });

    it('should show values from JSON files', () => {
      const output = execSync(`node ${CLI_PATH} config-files values -p ${testRoot} --file config.json`).toString();

      expect(output).toContain('Configuration Values');
      expect(output).toContain('app.name');
      expect(output).toContain('test-app');
      expect(output).toContain('database.port');
      expect(output).toContain('5432');
      expect(output).toContain('features.authentication');
      expect(output).toContain('true');
    });

    it('should show values from YAML files', () => {
      const output = execSync(`node ${CLI_PATH} config-files values -p ${testRoot} --file config.yml`).toString();

      expect(output).toContain('Configuration Values');
      expect(output).toContain('application.name');
      expect(output).toContain('test-app');
      expect(output).toContain('database.primary.host');
      expect(output).toContain('localhost');
    });

    it('should show values from TOML files', () => {
      const output = execSync(`node ${CLI_PATH} config-files values -p ${testRoot} --file config.toml`).toString();

      expect(output).toContain('Configuration Values');
      expect(output).toContain('title');
      expect(output).toContain('Configuration');
      expect(output).toContain('database.server');
      expect(output).toContain('192.168.1.1');
    });

    it('should redact sensitive values by default', () => {
      const output = execSync(`node ${CLI_PATH} config-files values -p ${testRoot} --file .env`).toString();

      // Sensitive keys should be redacted
      expect(output).toContain('API_KEY');
      expect(output).not.toContain('secret-key-123');
      expect(output).toContain('***');
    });

    it('should show sensitive values with --show-secrets flag', () => {
      const output = execSync(`node ${CLI_PATH} config-files values -p ${testRoot} --file .env --show-secrets`).toString();

      // Sensitive keys should be visible with flag
      expect(output).toContain('API_KEY');
      expect(output).toContain('secret-key-123');
    });
  });

  describe('Format-Specific Features', () => {
    it('should handle .env comments', () => {
      const output = execSync(`node ${CLI_PATH} config-files keys -p ${testRoot} --file .env`).toString();

      // Should not include comment lines
      expect(output).not.toContain('Application Configuration');
    });

    it('should handle nested JSON structures', () => {
      const output = execSync(`node ${CLI_PATH} config-files keys -p ${testRoot} --file server.config.json`).toString();

      // Should flatten nested structures with dot notation
      expect(output).toContain('server.ssl.enabled');
      expect(output).toContain('server.ssl.cert');
      expect(output).toContain('server.ssl.key');
    });

    it('should handle YAML arrays', () => {
      const output = execSync(`node ${CLI_PATH} config-files keys -p ${testRoot} --file docker-compose.yaml`).toString();

      // Should show array values
      expect(output).toContain('services.web.ports');
      expect(output).toContain('services.web.environment');
    });

    it('should handle TOML tables', () => {
      const output = execSync(`node ${CLI_PATH} config-files keys -p ${testRoot} --file config.toml`).toString();

      // Should show TOML table sections
      expect(output).toContain('servers.alpha');
      expect(output).toContain('servers.beta');
    });
  });

  describe('Edge Cases', () => {
    it('should handle project without config files gracefully', () => {
      const noConfigDir = fs.mkdtempSync(path.join(os.tmpdir(), 'no-config-'));

      fs.writeFileSync(
        path.join(noConfigDir, 'package.json'),
        JSON.stringify({ name: 'test', dependencies: {} })
      );

      try {
        // Non-detected strategies warn and report nothing (exit 0) instead of failing.
        const output = execSync(`node ${CLI_PATH} config-files list -p ${noConfigDir} 2>&1`).toString();
        expect(output).toContain('Extension "config-files" did not detect an applicable project');
        expect(output).toMatch(/Total:\s*0\s*file\(s\)/);
      } finally {
        fs.rmSync(noConfigDir, { recursive: true, force: true });
      }
    });

    it('should handle malformed JSON gracefully', () => {
      const malformedDir = fs.mkdtempSync(path.join(os.tmpdir(), 'malformed-'));

      fs.writeFileSync(
        path.join(malformedDir, 'package.json'),
        JSON.stringify({ name: 'test' })
      );

      fs.writeFileSync(
        path.join(malformedDir, 'config.json'),
        '{ invalid json content'
      );

      try {
        execSync(`node ${CLI_PATH} config-files values -p ${malformedDir} --file config.json 2>&1`);
      } catch (e: any) {
        const output = e.stdout ? e.stdout.toString() : e.stderr.toString();
        expect(output).toContain('Error parsing');
        expect(output).toContain('config.json');
      } finally {
        fs.rmSync(malformedDir, { recursive: true, force: true });
      }
    });

    it('should handle malformed YAML gracefully', () => {
      const malformedDir = fs.mkdtempSync(path.join(os.tmpdir(), 'malformed-yaml-'));

      fs.writeFileSync(
        path.join(malformedDir, 'package.json'),
        JSON.stringify({ name: 'test' })
      );

      fs.writeFileSync(
        path.join(malformedDir, 'config.yml'),
        'invalid:\n  - yaml\n- content'
      );

      try {
        execSync(`node ${CLI_PATH} config-files values -p ${malformedDir} --file config.yml 2>&1`);
      } catch (e: any) {
        const output = e.stdout ? e.stdout.toString() : e.stderr.toString();
        expect(output).toContain('Error parsing');
      } finally {
        fs.rmSync(malformedDir, { recursive: true, force: true });
      }
    });

    it('should handle non-existent file', () => {
      // A missing file is reported per-file and yields an empty result (exit 0).
      const output = execSync(`node ${CLI_PATH} config-files values -p ${testRoot} --file nonexistent.json 2>&1`).toString();
      expect(output).toContain('Error parsing');
      expect(output).toContain('nonexistent.json');
      expect(output).toContain('ENOENT');
    });
  });

  describe('Pattern Matching', () => {
    it('should filter by pattern', () => {
      const output = execSync(`node ${CLI_PATH} config-files list -p ${testRoot} --pattern ".env*"`).toString();

      expect(output).toContain('.env');
      expect(output).toContain('.env.local');
      expect(output).toContain('.env.production');
      expect(output).not.toContain('config.json');
      expect(output).not.toContain('config.yml');
    });

    it('should filter JSON files', () => {
      const output = execSync(`node ${CLI_PATH} config-files list -p ${testRoot} --pattern "**/*.json"`).toString();

      expect(output).toContain('config.json');
      expect(output).toContain('server.config.json');
      expect(output).toContain('database.json');
      expect(output).not.toContain('.env');
      expect(output).not.toContain('.yml');
    });

    it('should filter YAML files', () => {
      const output = execSync(`node ${CLI_PATH} config-files list -p ${testRoot} --pattern "*.{yml,yaml}"`).toString();

      expect(output).toContain('config.yml');
      expect(output).toContain('docker-compose.yaml');
      expect(output).not.toContain('.env');
      expect(output).not.toContain('config.json');
    });
  });
});
