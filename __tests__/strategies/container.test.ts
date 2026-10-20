// __tests__/strategies/container.test.ts
import { StrategyContextImpl } from '../../src/lib/strategy/context';
import ContainerStrategy from '../../strategies/container';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

describe('ContainerStrategy', () => {
  let strategy: ContainerStrategy;

  beforeEach(() => {
    strategy = new ContainerStrategy();
  });

  describe('metadata', () => {
    it('should have correct name and version', () => {
      expect(strategy.name).toBe('container');
      expect(strategy.version).toBe('0.1.0');
    });
  });

  describe('Dockerfile Parser', () => {
    describe('single-stage builds', () => {
      it('should parse a simple Dockerfile with basic instructions', async () => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-dockerfile-simple-'));

        const dockerfile = `FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
EXPOSE 3000
CMD ["node", "index.js"]`;

        fs.writeFileSync(path.join(tempDir, 'Dockerfile'), dockerfile);

        const ctx = new StrategyContextImpl(tempDir);
        const metadata = await strategy.analyze(path.join(tempDir, 'Dockerfile'), ctx);

        expect(metadata.tags).toContain('container:dockerfile');
        expect(metadata.metadata?.stages).toHaveLength(1);
        expect(metadata.metadata?.stages[0].from).toBe('node:18-alpine');
        expect(metadata.metadata?.baseImages).toContain('node:18-alpine');
        expect(metadata.metadata?.exposedPorts).toContain(3000);
        expect(metadata.metadata?.entrypoint).toEqual(['node', 'index.js']);
        expect(metadata.metadata?.isMultiStage).toBe(false);

        fs.rmSync(tempDir, { recursive: true, force: true });
      });

      it('should parse EXPOSE with multiple ports', async () => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-dockerfile-ports-'));

        const dockerfile = `FROM nginx:latest
EXPOSE 80 443
EXPOSE 8080`;

        fs.writeFileSync(path.join(tempDir, 'Dockerfile'), dockerfile);

        const ctx = new StrategyContextImpl(tempDir);
        const metadata = await strategy.analyze(path.join(tempDir, 'Dockerfile'), ctx);

        expect(metadata.metadata?.exposedPorts).toEqual([80, 443, 8080]);

        fs.rmSync(tempDir, { recursive: true, force: true });
      });

      it('should parse ENV variables', async () => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-dockerfile-env-'));

        const dockerfile = `FROM node:18
ENV NODE_ENV production
ENV PORT 3000
ENV API_URL https://api.example.com`;

        fs.writeFileSync(path.join(tempDir, 'Dockerfile'), dockerfile);

        const ctx = new StrategyContextImpl(tempDir);
        const metadata = await strategy.analyze(path.join(tempDir, 'Dockerfile'), ctx);

        expect(metadata.metadata?.env).toEqual({
          NODE_ENV: 'production',
          PORT: '3000',
          API_URL: 'https://api.example.com'
        });

        fs.rmSync(tempDir, { recursive: true, force: true });
      });

      it('should parse VOLUME declarations', async () => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-dockerfile-volume-'));

        const dockerfile = `FROM postgres:15
VOLUME /var/lib/postgresql/data
VOLUME ["/var/log"]`;

        fs.writeFileSync(path.join(tempDir, 'Dockerfile'), dockerfile);

        const ctx = new StrategyContextImpl(tempDir);
        const metadata = await strategy.analyze(path.join(tempDir, 'Dockerfile'), ctx);

        expect(metadata.metadata?.volumes).toContain('/var/lib/postgresql/data');
        expect(metadata.metadata?.volumes).toContain('/var/log');

        fs.rmSync(tempDir, { recursive: true, force: true });
      });

      it('should parse ARG declarations', async () => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-dockerfile-arg-'));

        const dockerfile = `ARG NODE_VERSION=18
FROM node:\${NODE_VERSION}-alpine
ARG BUILD_DATE
ARG VERSION=1.0.0`;

        fs.writeFileSync(path.join(tempDir, 'Dockerfile'), dockerfile);

        const ctx = new StrategyContextImpl(tempDir);
        const metadata = await strategy.analyze(path.join(tempDir, 'Dockerfile'), ctx);

        expect(metadata.metadata?.args).toContain('NODE_VERSION');
        expect(metadata.metadata?.args).toContain('BUILD_DATE');
        expect(metadata.metadata?.args).toContain('VERSION');

        fs.rmSync(tempDir, { recursive: true, force: true });
      });

      it('should handle ENTRYPOINT and CMD separately', async () => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-dockerfile-entry-'));

        const dockerfile = `FROM node:18
ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["node", "server.js"]`;

        fs.writeFileSync(path.join(tempDir, 'Dockerfile'), dockerfile);

        const ctx = new StrategyContextImpl(tempDir);
        const metadata = await strategy.analyze(path.join(tempDir, 'Dockerfile'), ctx);

        expect(metadata.metadata?.entrypoint).toEqual(['docker-entrypoint.sh']);
        expect(metadata.metadata?.cmd).toEqual(['node', 'server.js']);

        fs.rmSync(tempDir, { recursive: true, force: true });
      });
    });

    describe('multi-stage builds', () => {
      it('should parse multi-stage Dockerfile with named stages', async () => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-dockerfile-multi-'));

        const dockerfile = `FROM node:18-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:18-alpine AS production
WORKDIR /app
COPY --from=builder /app/dist ./dist
COPY package*.json ./
RUN npm ci --production
EXPOSE 3000
CMD ["node", "dist/index.js"]`;

        fs.writeFileSync(path.join(tempDir, 'Dockerfile'), dockerfile);

        const ctx = new StrategyContextImpl(tempDir);
        const metadata = await strategy.analyze(path.join(tempDir, 'Dockerfile'), ctx);

        expect(metadata.tags).toContain('container:dockerfile');
        expect(metadata.tags).toContain('stage:builder');
        expect(metadata.tags).toContain('stage:production');
        expect(metadata.metadata?.isMultiStage).toBe(true);
        expect(metadata.metadata?.stages).toHaveLength(2);
        expect(metadata.metadata?.stages[0].name).toBe('builder');
        expect(metadata.metadata?.stages[0].from).toBe('node:18-alpine');
        expect(metadata.metadata?.stages[1].name).toBe('production');
        expect(metadata.metadata?.stages[1].from).toBe('node:18-alpine');
        expect(metadata.metadata?.baseImages).toEqual(['node:18-alpine', 'node:18-alpine']);

        fs.rmSync(tempDir, { recursive: true, force: true });
      });

      it('should parse multi-stage build without named stages', async () => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-dockerfile-multi-unnamed-'));

        const dockerfile = `FROM golang:1.20
WORKDIR /app
COPY . .
RUN go build -o main .

FROM alpine:latest
COPY --from=0 /app/main /usr/local/bin/
CMD ["main"]`;

        fs.writeFileSync(path.join(tempDir, 'Dockerfile'), dockerfile);

        const ctx = new StrategyContextImpl(tempDir);
        const metadata = await strategy.analyze(path.join(tempDir, 'Dockerfile'), ctx);

        expect(metadata.metadata?.isMultiStage).toBe(true);
        expect(metadata.metadata?.stages).toHaveLength(2);
        expect(metadata.metadata?.stages[0].name).toBeUndefined();
        expect(metadata.metadata?.stages[0].from).toBe('golang:1.20');
        expect(metadata.metadata?.stages[1].from).toBe('alpine:latest');
        expect(metadata.metadata?.baseImages).toEqual(['golang:1.20', 'alpine:latest']);

        fs.rmSync(tempDir, { recursive: true, force: true });
      });

      it('should detect COPY --from instructions in multi-stage builds', async () => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-dockerfile-copy-from-'));

        const dockerfile = `FROM node:18 AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci

FROM node:18 AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM nginx:alpine
COPY --from=builder /app/dist /usr/share/nginx/html`;

        fs.writeFileSync(path.join(tempDir, 'Dockerfile'), dockerfile);

        const ctx = new StrategyContextImpl(tempDir);
        const metadata = await strategy.analyze(path.join(tempDir, 'Dockerfile'), ctx);

        expect(metadata.metadata?.stages).toHaveLength(3);
        const builderStage = metadata.metadata?.stages[1];
        const copyFromDeps = builderStage.commands.find(
          (cmd: any) => cmd.instruction === 'COPY' && cmd.args.includes('--from=deps')
        );
        expect(copyFromDeps).toBeDefined();

        fs.rmSync(tempDir, { recursive: true, force: true });
      });
    });

    describe('edge cases', () => {
      it('should ignore comments and empty lines', async () => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-dockerfile-comments-'));

        const dockerfile = `# This is a comment
FROM node:18

# Install dependencies
WORKDIR /app

COPY package.json .
# Another comment
RUN npm install

CMD ["node", "index.js"]`;

        fs.writeFileSync(path.join(tempDir, 'Dockerfile'), dockerfile);

        const ctx = new StrategyContextImpl(tempDir);
        const metadata = await strategy.analyze(path.join(tempDir, 'Dockerfile'), ctx);

        expect(metadata.metadata?.stages).toHaveLength(1);
        expect(metadata.metadata?.stages[0].commands).toHaveLength(4); // WORKDIR, COPY, RUN, CMD

        fs.rmSync(tempDir, { recursive: true, force: true });
      });

      it('should handle Containerfile (Podman)', async () => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-containerfile-'));

        const containerfile = `FROM fedora:latest
RUN dnf install -y python3
CMD ["python3"]`;

        fs.writeFileSync(path.join(tempDir, 'Containerfile'), containerfile);

        const ctx = new StrategyContextImpl(tempDir);
        const metadata = await strategy.analyze(path.join(tempDir, 'Containerfile'), ctx);

        expect(metadata.tags).toContain('container:dockerfile');
        expect(metadata.metadata?.stages[0].from).toBe('fedora:latest');

        fs.rmSync(tempDir, { recursive: true, force: true });
      });
    });
  });

  describe('docker-compose Parser', () => {
    describe('basic compose files', () => {
      it('should parse simple docker-compose.yml with services', async () => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-compose-simple-'));

        const composeFile = `version: '3.8'
services:
  web:
    image: nginx:latest
    ports:
      - "80:80"
  db:
    image: postgres:15
    environment:
      POSTGRES_PASSWORD: secret`;

        fs.writeFileSync(path.join(tempDir, 'docker-compose.yml'), composeFile);

        const ctx = new StrategyContextImpl(tempDir);
        const metadata = await strategy.analyze(path.join(tempDir, 'docker-compose.yml'), ctx);

        expect(metadata.tags).toContain('container:compose');
        expect(metadata.tags).toContain('service:web');
        expect(metadata.tags).toContain('service:db');
        expect(metadata.metadata?.services).toHaveLength(2);
        expect(metadata.metadata?.services[0].name).toBe('web');
        expect(metadata.metadata?.services[0].image).toBe('nginx:latest');
        expect(metadata.metadata?.services[1].name).toBe('db');
        expect(metadata.metadata?.services[1].environment).toEqual({ POSTGRES_PASSWORD: 'secret' });

        fs.rmSync(tempDir, { recursive: true, force: true });
      });

      it('should parse services with build context', async () => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-compose-build-'));

        const composeFile = `version: '3.8'
services:
  app:
    build: .
    ports:
      - "3000:3000"
  api:
    build:
      context: ./api
      dockerfile: Dockerfile.dev`;

        fs.writeFileSync(path.join(tempDir, 'docker-compose.yml'), composeFile);

        const ctx = new StrategyContextImpl(tempDir);
        const metadata = await strategy.analyze(path.join(tempDir, 'docker-compose.yml'), ctx);

        expect(metadata.metadata?.services[0].build).toBe('.');
        expect(metadata.metadata?.services[1].build).toEqual({
          context: './api',
          dockerfile: 'Dockerfile.dev'
        });

        fs.rmSync(tempDir, { recursive: true, force: true });
      });

      it('should parse service dependencies (depends_on)', async () => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-compose-deps-'));

        const composeFile = `version: '3.8'
services:
  web:
    image: myapp:latest
    depends_on:
      - db
      - redis
  db:
    image: postgres:15
  redis:
    image: redis:7-alpine`;

        fs.writeFileSync(path.join(tempDir, 'docker-compose.yml'), composeFile);

        const ctx = new StrategyContextImpl(tempDir);
        const metadata = await strategy.analyze(path.join(tempDir, 'docker-compose.yml'), ctx);

        expect(metadata.metadata?.services[0].dependsOn).toEqual(['db', 'redis']);

        fs.rmSync(tempDir, { recursive: true, force: true });
      });

      it('should parse depends_on with conditions (object format)', async () => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-compose-deps-obj-'));

        const composeFile = `version: '3.8'
services:
  web:
    image: myapp:latest
    depends_on:
      db:
        condition: service_healthy
      redis:
        condition: service_started
  db:
    image: postgres:15
  redis:
    image: redis:7-alpine`;

        fs.writeFileSync(path.join(tempDir, 'docker-compose.yml'), composeFile);

        const ctx = new StrategyContextImpl(tempDir);
        const metadata = await strategy.analyze(path.join(tempDir, 'docker-compose.yml'), ctx);

        expect(metadata.metadata?.services[0].dependsOn).toEqual(['db', 'redis']);

        fs.rmSync(tempDir, { recursive: true, force: true });
      });

      it('should parse volumes', async () => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-compose-volumes-'));

        const composeFile = `version: '3.8'
services:
  db:
    image: postgres:15
    volumes:
      - db_data:/var/lib/postgresql/data
      - ./init.sql:/docker-entrypoint-initdb.d/init.sql
volumes:
  db_data:`;

        fs.writeFileSync(path.join(tempDir, 'docker-compose.yml'), composeFile);

        const ctx = new StrategyContextImpl(tempDir);
        const metadata = await strategy.analyze(path.join(tempDir, 'docker-compose.yml'), ctx);

        expect(metadata.metadata?.services[0].volumes).toEqual([
          'db_data:/var/lib/postgresql/data',
          './init.sql:/docker-entrypoint-initdb.d/init.sql'
        ]);
        expect(metadata.metadata?.volumes).toContain('db_data');

        fs.rmSync(tempDir, { recursive: true, force: true });
      });

      it('should parse networks', async () => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-compose-networks-'));

        const composeFile = `version: '3.8'
services:
  web:
    image: nginx
    networks:
      - frontend
  api:
    image: node:18
    networks:
      - frontend
      - backend
  db:
    image: postgres:15
    networks:
      - backend
networks:
  frontend:
  backend:`;

        fs.writeFileSync(path.join(tempDir, 'docker-compose.yml'), composeFile);

        const ctx = new StrategyContextImpl(tempDir);
        const metadata = await strategy.analyze(path.join(tempDir, 'docker-compose.yml'), ctx);

        expect(metadata.metadata?.networks).toEqual(['frontend', 'backend']);
        expect(metadata.metadata?.services[1].networks).toEqual(['frontend', 'backend']);

        fs.rmSync(tempDir, { recursive: true, force: true });
      });
    });

    describe('edge cases', () => {
      it('should handle compose.yml (alternative filename)', async () => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-compose-alt-'));

        const composeFile = `version: '3.8'
services:
  app:
    image: myapp:latest`;

        fs.writeFileSync(path.join(tempDir, 'compose.yml'), composeFile);

        const ctx = new StrategyContextImpl(tempDir);
        const metadata = await strategy.analyze(path.join(tempDir, 'compose.yml'), ctx);

        expect(metadata.tags).toContain('container:compose');
        expect(metadata.metadata?.services).toHaveLength(1);

        fs.rmSync(tempDir, { recursive: true, force: true });
      });

      it('should handle services with no dependencies', async () => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-compose-no-deps-'));

        const composeFile = `version: '3.8'
services:
  standalone:
    image: redis:latest`;

        fs.writeFileSync(path.join(tempDir, 'docker-compose.yml'), composeFile);

        const ctx = new StrategyContextImpl(tempDir);
        const metadata = await strategy.analyze(path.join(tempDir, 'docker-compose.yml'), ctx);

        expect(metadata.metadata?.services[0].dependsOn).toEqual([]);

        fs.rmSync(tempDir, { recursive: true, force: true });
      });
    });
  });

  describe('detection', () => {
    it('should detect projects with Dockerfile', async () => {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-detect-dockerfile-'));

      fs.writeFileSync(path.join(tempDir, 'Dockerfile'), 'FROM node:18');

      const ctx = new StrategyContextImpl(tempDir);
      const detected = await strategy.detect(ctx);

      expect(detected).toBe(true);

      fs.rmSync(tempDir, { recursive: true, force: true });
    });

    it('should detect projects with docker-compose.yml', async () => {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-detect-compose-'));

      fs.writeFileSync(path.join(tempDir, 'docker-compose.yml'), 'version: "3.8"\nservices:\n  app:\n    image: node:18');

      const ctx = new StrategyContextImpl(tempDir);
      const detected = await strategy.detect(ctx);

      expect(detected).toBe(true);

      fs.rmSync(tempDir, { recursive: true, force: true });
    });

    it('should detect projects with Containerfile', async () => {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-detect-containerfile-'));

      fs.writeFileSync(path.join(tempDir, 'Containerfile'), 'FROM fedora:latest');

      const ctx = new StrategyContextImpl(tempDir);
      const detected = await strategy.detect(ctx);

      expect(detected).toBe(true);

      fs.rmSync(tempDir, { recursive: true, force: true });
    });

    it('should not detect projects without container files', async () => {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-detect-none-'));

      fs.writeFileSync(path.join(tempDir, 'package.json'), '{}');

      const ctx = new StrategyContextImpl(tempDir);
      const detected = await strategy.detect(ctx);

      expect(detected).toBe(false);

      fs.rmSync(tempDir, { recursive: true, force: true });
    });
  });

  describe('fileTypes', () => {
    it('should return correct file patterns', () => {
      const fileTypes = strategy.fileTypes();
      expect(fileTypes).toContain('Dockerfile');
      expect(fileTypes).toContain('*.dockerfile');
      expect(fileTypes).toContain('Containerfile');
      expect(fileTypes).toContain('docker-compose.yml');
      expect(fileTypes).toContain('docker-compose.yaml');
      expect(fileTypes).toContain('compose.yml');
      expect(fileTypes).toContain('compose.yaml');
    });
  });

  describe('ignorePatterns', () => {
    it('should return patterns to ignore', () => {
      const ignorePatterns = strategy.ignorePatterns();
      expect(ignorePatterns).toContain('**/node_modules/**');
      expect(ignorePatterns).toContain('**/dist/**');
      expect(ignorePatterns).toContain('**/build/**');
    });
  });

  describe('commands', () => {
    describe('container:analyze', () => {
      it('should return analysis of Dockerfile and docker-compose files', async () => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-cmd-analyze-'));

        const dockerfile = `FROM node:18-alpine AS builder
WORKDIR /app
RUN npm ci

FROM node:18-alpine
COPY --from=builder /app/dist ./dist
EXPOSE 3000`;

        const composeFile = `version: '3.8'
services:
  web:
    build: .
    ports:
      - "3000:3000"
  db:
    image: postgres:15`;

        fs.writeFileSync(path.join(tempDir, 'Dockerfile'), dockerfile);
        fs.writeFileSync(path.join(tempDir, 'docker-compose.yml'), composeFile);

        const ctx = new StrategyContextImpl(tempDir) as any;

        // First analyze the files to populate metadata
        const dockerfileMetadata = await strategy.analyze(path.join(tempDir, 'Dockerfile'), ctx);
        const composeMetadata = await strategy.analyze(path.join(tempDir, 'docker-compose.yml'), ctx);

        // Manually set metadata in context (simulating what the runner would do)
        // Use relative paths as that's what findFiles returns
        ctx.setMetadata('Dockerfile', 'container', dockerfileMetadata.metadata);
        ctx.setMetadata('docker-compose.yml', 'container', composeMetadata.metadata);
        dockerfileMetadata.tags.forEach((tag: string) => ctx.addTag('Dockerfile', tag));
        composeMetadata.tags.forEach((tag: string) => ctx.addTag('docker-compose.yml', tag));

        // Now run the analyze command
        const result = await strategy.commands.analyze.handler(ctx);

        expect(result).toBeDefined();
        expect(result.dockerfiles).toHaveLength(1);
        expect(result.composeFiles).toHaveLength(1);
        expect(result.dockerfiles[0].isMultiStage).toBe(true);
        expect(result.composeFiles[0].services).toHaveLength(2);

        fs.rmSync(tempDir, { recursive: true, force: true });
      });
    });

    describe('container:services', () => {
      it('should list all services from docker-compose files', async () => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-cmd-services-'));

        const composeFile = `version: '3.8'
services:
  web:
    image: nginx:latest
    depends_on:
      - api
  api:
    build: .
    depends_on:
      - db
  db:
    image: postgres:15`;

        fs.writeFileSync(path.join(tempDir, 'docker-compose.yml'), composeFile);

        const ctx = new StrategyContextImpl(tempDir) as any;

        // Analyze the file first
        const metadata = await strategy.analyze(path.join(tempDir, 'docker-compose.yml'), ctx);

        // Set metadata and tags in context (use relative paths)
        ctx.setMetadata('docker-compose.yml', 'container', metadata.metadata);
        metadata.tags.forEach((tag: string) => ctx.addTag('docker-compose.yml', tag));

        // Run the services command
        const services = await strategy.commands.services.handler(ctx);

        expect(services).toHaveLength(3);
        expect(services[0].name).toBe('web');
        expect(services[0].dependsOn).toEqual(['api']);
        expect(services[1].name).toBe('api');
        expect(services[1].dependsOn).toEqual(['db']);
        expect(services[2].name).toBe('db');

        fs.rmSync(tempDir, { recursive: true, force: true });
      });
    });

    describe('container:stages', () => {
      it('should list all build stages from Dockerfiles', async () => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-cmd-stages-'));

        const dockerfile = `FROM node:18-alpine AS deps
WORKDIR /app
COPY package*.json ./

FROM node:18-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
RUN npm run build

FROM nginx:alpine AS production
COPY --from=builder /app/dist /usr/share/nginx/html`;

        fs.writeFileSync(path.join(tempDir, 'Dockerfile'), dockerfile);

        const ctx = new StrategyContextImpl(tempDir) as any;

        // Analyze the file first
        const metadata = await strategy.analyze(path.join(tempDir, 'Dockerfile'), ctx);

        // Set metadata and tags in context (use relative paths)
        ctx.setMetadata('Dockerfile', 'container', metadata.metadata);
        metadata.tags.forEach((tag: string) => ctx.addTag('Dockerfile', tag));

        // Run the stages command
        const stages = await strategy.commands.stages.handler(ctx);

        expect(stages).toHaveLength(3);
        expect(stages[0].name).toBe('deps');
        expect(stages[0].from).toBe('node:18-alpine');
        expect(stages[1].name).toBe('builder');
        expect(stages[1].from).toBe('node:18-alpine');
        expect(stages[2].name).toBe('production');
        expect(stages[2].from).toBe('nginx:alpine');

        fs.rmSync(tempDir, { recursive: true, force: true });
      });
    });
  });
});
