// __tests__/strategy/infrastructure/parsers/helm.test.ts
import { parseHelm, helmTool } from '../../../../src/lib/strategy/infrastructure/parsers/helm';

describe('Helm Parser', () => {
  describe('parseHelm - Chart.yaml', () => {
    it('should parse basic Chart.yaml', () => {
      const content = `
apiVersion: v2
name: my-app
description: A Helm chart for Kubernetes
type: application
version: 0.1.0
appVersion: "1.16.0"
`;

      const config = parseHelm('Chart.yaml', content);

      expect(config.tool).toBe('helm');
      expect(config.resources).toHaveLength(1);
      expect(config.resources[0]).toMatchObject({
        type: 'helm-chart',
        name: 'my-app',
        properties: {
          version: '0.1.0',
          appVersion: '1.16.0',
          description: 'A Helm chart for Kubernetes',
          type: 'application'
        }
      });
    });

    it('should parse Chart.yaml with dependencies', () => {
      const content = `
apiVersion: v2
name: my-app
version: 1.0.0
dependencies:
  - name: postgresql
    version: 11.1.0
    repository: https://charts.bitnami.com/bitnami
  - name: redis
    version: 16.4.0
    repository: https://charts.bitnami.com/bitnami
    condition: redis.enabled
`;

      const config = parseHelm('Chart.yaml', content);

      expect(config.resources[0].dependencies).toEqual([
        'postgresql@11.1.0',
        'redis@16.4.0'
      ]);
      expect(config.dependencies).toEqual({
        'my-app': ['postgresql@11.1.0', 'redis@16.4.0']
      });
    });

    it('should parse Chart.yaml with maintainers', () => {
      const content = `
apiVersion: v2
name: my-app
version: 1.0.0
maintainers:
  - name: John Doe
    email: john@example.com
  - name: Jane Smith
    email: jane@example.com
`;

      const config = parseHelm('Chart.yaml', content);

      expect(config.resources[0].properties?.maintainers).toHaveLength(2);
      expect(config.resources[0].properties?.maintainers[0]).toMatchObject({
        name: 'John Doe',
        email: 'john@example.com'
      });
    });

    it('should parse Chart.yaml with keywords', () => {
      const content = `
apiVersion: v2
name: my-app
version: 1.0.0
keywords:
  - web
  - application
  - microservice
`;

      const config = parseHelm('Chart.yaml', content);

      expect(config.resources[0].properties?.keywords).toEqual([
        'web',
        'application',
        'microservice'
      ]);
    });

    it('should parse library chart', () => {
      const content = `
apiVersion: v2
name: my-library
type: library
version: 1.0.0
`;

      const config = parseHelm('Chart.yaml', content);

      expect(config.resources[0].properties?.type).toBe('library');
    });
  });

  describe('parseHelm - values.yaml', () => {
    it('should parse basic values.yaml', () => {
      const content = `
replicaCount: 3

image:
  repository: nginx
  pullPolicy: IfNotPresent
  tag: "1.16.0"

service:
  type: ClusterIP
  port: 80
`;

      const config = parseHelm('values.yaml', content);

      expect(config.tool).toBe('helm');
      expect(config.variables).toBeDefined();
      expect(config.variables!.replicaCount).toBe(3);
      expect(config.variables!.image).toMatchObject({
        repository: 'nginx',
        pullPolicy: 'IfNotPresent',
        tag: '1.16.0'
      });
    });

    it('should parse values.yaml with nested structures', () => {
      const content = `
ingress:
  enabled: true
  className: nginx
  annotations:
    cert-manager.io/cluster-issuer: letsencrypt
  hosts:
    - host: example.com
      paths:
        - path: /
          pathType: Prefix
`;

      const config = parseHelm('values.yaml', content);

      expect(config.variables!.ingress.enabled).toBe(true);
      expect(config.variables!.ingress.hosts).toHaveLength(1);
    });

    it('should parse values.yaml with resources', () => {
      const content = `
resources:
  limits:
    cpu: 100m
    memory: 128Mi
  requests:
    cpu: 50m
    memory: 64Mi
`;

      const config = parseHelm('values.yaml', content);

      expect(config.variables!.resources.limits.cpu).toBe('100m');
      expect(config.variables!.resources.requests.memory).toBe('64Mi');
    });

    it('should parse values.yaml with autoscaling', () => {
      const content = `
autoscaling:
  enabled: true
  minReplicas: 2
  maxReplicas: 10
  targetCPUUtilizationPercentage: 80
  targetMemoryUtilizationPercentage: 80
`;

      const config = parseHelm('values.yaml', content);

      expect(config.variables!.autoscaling).toMatchObject({
        enabled: true,
        minReplicas: 2,
        maxReplicas: 10
      });
    });

    it('should parse values.yaml with environment variables', () => {
      const content = `
env:
  - name: DATABASE_HOST
    value: postgres.example.com
  - name: DATABASE_PORT
    value: "5432"
  - name: API_KEY
    valueFrom:
      secretKeyRef:
        name: api-secret
        key: key
`;

      const config = parseHelm('values.yaml', content);

      expect(config.variables!.env).toHaveLength(3);
      expect(config.variables!.env[0].name).toBe('DATABASE_HOST');
    });

    it('should parse values.yaml with persistence', () => {
      const content = `
persistence:
  enabled: true
  storageClass: "gp2"
  accessMode: ReadWriteOnce
  size: 10Gi
`;

      const config = parseHelm('values.yaml', content);

      expect(config.variables!.persistence).toMatchObject({
        enabled: true,
        storageClass: 'gp2',
        size: '10Gi'
      });
    });
  });

  describe('parseHelm - combined Chart and values', () => {
    it('should extract outputs from Chart.yaml', () => {
      const content = `
apiVersion: v2
name: my-app
version: 1.0.0
appVersion: "1.0.0"
`;

      const config = parseHelm('Chart.yaml', content);

      expect(config.outputs).toBeDefined();
      expect(config.outputs!.chartVersion).toBe('1.0.0');
      expect(config.outputs!.appVersion).toBe('1.0.0');
    });
  });

  describe('parseHelm - edge cases', () => {
    it('should handle empty Chart.yaml', () => {
      const config = parseHelm('Chart.yaml', '');

      expect(config.tool).toBe('helm');
      expect(config.resources).toEqual([]);
    });

    it('should handle empty values.yaml', () => {
      const config = parseHelm('values.yaml', '');

      expect(config.tool).toBe('helm');
      expect(config.variables).toEqual({});
    });

    it('should handle Chart.yaml with null content', () => {
      // YAML that parses to null (e.g., just whitespace or comments)
      const content = `
# Just comments
# No actual content
`;

      const config = parseHelm('Chart.yaml', content);

      expect(config.tool).toBe('helm');
      expect(config.resources).toEqual([]);
    });

    it('should handle Chart.yaml with minimal fields', () => {
      const content = `
apiVersion: v2
name: minimal
version: 1.0.0
`;

      const config = parseHelm('Chart.yaml', content);

      expect(config.resources[0]).toMatchObject({
        type: 'helm-chart',
        name: 'minimal',
        properties: {
          version: '1.0.0'
        }
      });
    });

    it('should handle invalid YAML gracefully', () => {
      const content = 'invalid: yaml: content:';

      expect(() => parseHelm('Chart.yaml', content)).toThrow();
    });

    it('should handle unknown helm file type', () => {
      // File that's neither Chart.yaml nor values*
      const content = `
name: test
data: value
`;

      const config = parseHelm('some-other.yaml', content);

      expect(config.tool).toBe('helm');
      expect(config.resources).toEqual([]);
    });
  });

  describe('helmTool', () => {
    it('should detect Chart.yaml files', () => {
      const files = [
        'Chart.yaml',
        'charts/app/Chart.yaml',
        'values.yaml',
        'README.md'
      ];
      const detected = helmTool.detect(files);

      expect(detected).toEqual([
        'Chart.yaml',
        'charts/app/Chart.yaml',
        'values.yaml'
      ]);
    });

    it('should detect values.yaml files', () => {
      const files = [
        'values.yaml',
        'values.prod.yaml',
        'values-staging.yaml',
        'README.md'
      ];
      const detected = helmTool.detect(files);

      expect(detected).toContain('values.yaml');
    });

    it('should return null when no Helm files present', () => {
      const files = ['deployment.yaml', 'service.yaml', 'README.md'];
      const detected = helmTool.detect(files);

      expect(detected).toBeNull();
    });

    it('should have correct name', () => {
      expect(helmTool.name).toBe('helm');
    });
  });
});
