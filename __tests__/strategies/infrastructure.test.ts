// __tests__/strategies/infrastructure.test.ts
import InfrastructureStrategy from '../../strategies/infrastructure';
import { StrategyContext } from '../../src/lib/strategy/types';

describe('Infrastructure Strategy', () => {
  let mockContext: jest.Mocked<StrategyContext>;

  beforeEach(() => {
    mockContext = {
      hasDependency: jest.fn(),
      hasDevDependency: jest.fn(),
      hasFiles: jest.fn(),
      parseAST: jest.fn(),
      readFile: jest.fn(),
      findFiles: jest.fn(),
      hasTag: jest.fn(),
      getTags: jest.fn(),
      getMetadata: jest.fn(),
      getCached: jest.fn(),
      setCached: jest.fn(),
      globFiles: jest.fn(),
      getProjectRoot: jest.fn(),
      getConfig: jest.fn(),
      addFileTag: jest.fn(),
      setFileMetadata: jest.fn()
    } as any;
  });

  describe('metadata', () => {
    it('should have correct name and version', () => {
      const strategy = new InfrastructureStrategy();
      expect(strategy.name).toBe('infrastructure');
      expect(strategy.version).toBe('0.1.0');
    });
  });

  describe('detect', () => {
    it('should detect Terraform files', async () => {
      mockContext.globFiles.mockReturnValue(['main.tf', 'variables.tf']);

      const strategy = new InfrastructureStrategy();
      const detected = await strategy.detect(mockContext);

      expect(detected).toBe(true);
    });

    it('should detect Kubernetes manifests', async () => {
      mockContext.globFiles.mockReturnValue(['deployment.yaml', 'service.yaml']);

      const strategy = new InfrastructureStrategy();
      const detected = await strategy.detect(mockContext);

      expect(detected).toBe(true);
    });

    it('should detect Helm charts', async () => {
      mockContext.globFiles.mockReturnValue(['Chart.yaml', 'values.yaml']);

      const strategy = new InfrastructureStrategy();
      const detected = await strategy.detect(mockContext);

      expect(detected).toBe(true);
    });

    it('should detect CloudFormation templates', async () => {
      mockContext.globFiles.mockReturnValue(['template.yaml', 'stack.template.json']);

      const strategy = new InfrastructureStrategy();
      const detected = await strategy.detect(mockContext);

      expect(detected).toBe(true);
    });

    it('should not detect when no infrastructure files present', async () => {
      mockContext.globFiles.mockReturnValue(['package.json', 'index.js', 'README.md']);

      const strategy = new InfrastructureStrategy();
      const detected = await strategy.detect(mockContext);

      expect(detected).toBe(false);
    });
  });

  describe('fileTypes', () => {
    it('should return all infrastructure file patterns', () => {
      const strategy = new InfrastructureStrategy();
      const fileTypes = strategy.fileTypes!();

      expect(fileTypes).toContain('.tf');
      expect(fileTypes).toContain('.yaml');
      expect(fileTypes).toContain('.yml');
      expect(fileTypes).toContain('Chart.yaml');
      expect(fileTypes).toContain('values.yaml');
    });
  });

  describe('analyze', () => {
    it('should parse Terraform file and return metadata', async () => {
      const content = `
resource "aws_instance" "web" {
  ami = "ami-123"
  instance_type = "t2.micro"
}
`;
      mockContext.readFile.mockResolvedValue(content);

      const strategy = new InfrastructureStrategy();
      const metadata = await strategy.analyze('main.tf', mockContext);

      expect(metadata.tags).toContain('infra:aws_instance');
      expect(metadata.metadata?.tool).toBe('terraform');
      expect(metadata.metadata?.resources).toHaveLength(1);
    });

    it('should parse Kubernetes manifest and return metadata', async () => {
      const content = `
apiVersion: apps/v1
kind: Deployment
metadata:
  name: nginx
spec:
  replicas: 3
`;
      mockContext.readFile.mockResolvedValue(content);

      const strategy = new InfrastructureStrategy();
      const metadata = await strategy.analyze('deployment.yaml', mockContext);

      expect(metadata.tags).toContain('infra:Deployment');
      expect(metadata.metadata?.tool).toBe('kubernetes');
    });

    it('should parse Helm Chart.yaml and return metadata', async () => {
      const content = `
apiVersion: v2
name: my-app
version: 1.0.0
`;
      mockContext.readFile.mockResolvedValue(content);

      const strategy = new InfrastructureStrategy();
      const metadata = await strategy.analyze('Chart.yaml', mockContext);

      expect(metadata.tags).toContain('infra:helm-chart');
      expect(metadata.metadata?.tool).toBe('helm');
    });

    it('should parse CloudFormation template and return metadata', async () => {
      const content = `
Resources:
  MyBucket:
    Type: AWS::S3::Bucket
`;
      mockContext.readFile.mockResolvedValue(content);

      const strategy = new InfrastructureStrategy();
      const metadata = await strategy.analyze('template.yaml', mockContext);

      expect(metadata.tags).toContain('infra:AWS::S3::Bucket');
      expect(metadata.metadata?.tool).toBe('cloudformation');
    });

    it('should return empty metadata for non-infrastructure file', async () => {
      mockContext.readFile.mockResolvedValue('console.log("hello");');

      const strategy = new InfrastructureStrategy();
      const metadata = await strategy.analyze('index.js', mockContext);

      expect(metadata.tags).toEqual([]);
      expect(metadata.metadata).toEqual({});
    });
  });

  describe('commands - resources', () => {
    it('should list all infrastructure resources', async () => {
      mockContext.globFiles.mockReturnValue(['main.tf']);
      mockContext.getMetadata.mockReturnValue({
        tool: 'terraform',
        resources: [
          { type: 'aws_instance', name: 'web', properties: {} },
          { type: 'aws_security_group', name: 'allow_http', properties: {} }
        ]
      });

      const strategy = new InfrastructureStrategy();
      const result = await strategy.commands!.resources.handler(mockContext);

      expect(result).toHaveLength(2);
      expect(result[0]).toMatchObject({
        type: 'aws_instance',
        name: 'web',
        tool: 'terraform',
        file: 'main.tf'
      });
    });

    it('should handle multiple infrastructure tools', async () => {
      mockContext.globFiles.mockReturnValue(['main.tf', 'deployment.yaml']);
      mockContext.getMetadata
        .mockReturnValueOnce({
          tool: 'terraform',
          resources: [{ type: 'aws_instance', name: 'web' }]
        })
        .mockReturnValueOnce({
          tool: 'kubernetes',
          resources: [{ type: 'Deployment', name: 'nginx' }]
        });

      const strategy = new InfrastructureStrategy();
      const result = await strategy.commands!.resources.handler(mockContext);

      expect(result).toHaveLength(2);
      expect(result[0].tool).toBe('terraform');
      expect(result[1].tool).toBe('kubernetes');
    });

    it('should filter resources by type', async () => {
      mockContext.globFiles.mockReturnValue(['main.tf']);
      mockContext.getMetadata.mockReturnValue({
        tool: 'terraform',
        resources: [
          { type: 'aws_instance', name: 'web', properties: {} },
          { type: 'aws_security_group', name: 'allow_http', properties: {} }
        ]
      });

      const strategy = new InfrastructureStrategy();
      const result = await strategy.commands!.resources.handler(mockContext, { type: 'aws_instance' });

      expect(result).toHaveLength(1);
      expect(result[0].type).toBe('aws_instance');
    });

    it('should filter resources by tool', async () => {
      mockContext.globFiles.mockReturnValue(['main.tf', 'deployment.yaml']);
      mockContext.getMetadata
        .mockReturnValueOnce({
          tool: 'terraform',
          resources: [{ type: 'aws_instance', name: 'web' }]
        })
        .mockReturnValueOnce({
          tool: 'kubernetes',
          resources: [{ type: 'Deployment', name: 'nginx' }]
        });

      const strategy = new InfrastructureStrategy();
      const result = await strategy.commands!.resources.handler(mockContext, { tool: 'terraform' });

      expect(result).toHaveLength(1);
      expect(result[0].tool).toBe('terraform');
    });

    it('should filter resources by provider', async () => {
      mockContext.globFiles.mockReturnValue(['main.tf']);
      mockContext.getMetadata.mockReturnValue({
        tool: 'terraform',
        resources: [
          { type: 'aws_instance', name: 'web', properties: {} },
          { type: 'google_compute_instance', name: 'app', properties: {} }
        ]
      });

      const strategy = new InfrastructureStrategy();
      const result = await strategy.commands!.resources.handler(mockContext, { provider: 'aws' });

      expect(result).toHaveLength(1);
      expect(result[0].type).toBe('aws_instance');
    });
  });

  describe('commands - resources options', () => {
    it('declares type, tool and provider as CLI options', () => {
      const strategy = new InfrastructureStrategy();
      const options = strategy.commands!.resources.options as Record<string, unknown>;

      expect(Object.keys(options ?? {}).sort()).toEqual(['provider', 'tool', 'type']);
      for (const desc of Object.values(options)) {
        expect(typeof desc).toBe('string');
      }
    });
  });

  describe('commands - providers', () => {
    it('should list all cloud providers', async () => {
      mockContext.globFiles.mockReturnValue(['main.tf']);
      mockContext.getMetadata.mockReturnValue({
        tool: 'terraform',
        resources: [
          { type: 'aws_instance', name: 'web' },
          { type: 'google_compute_instance', name: 'app' },
          { type: 'aws_s3_bucket', name: 'data' }
        ]
      });

      const strategy = new InfrastructureStrategy();
      const result = await strategy.commands!.providers.handler(mockContext);

      expect(result).toContainEqual({
        provider: 'aws',
        count: 2,
        resources: ['aws_instance', 'aws_s3_bucket']
      });
      expect(result).toContainEqual({
        provider: 'google',
        count: 1,
        resources: ['google_compute_instance']
      });
    });

    it('should detect Azure providers', async () => {
      mockContext.globFiles.mockReturnValue(['main.tf', 'template.yaml']);
      mockContext.getMetadata
        .mockReturnValueOnce({
          tool: 'terraform',
          resources: [
            { type: 'azurerm_virtual_machine', name: 'vm' }
          ]
        })
        .mockReturnValueOnce({
          tool: 'cloudformation',
          resources: [
            { type: 'Azure::Compute::VirtualMachine', name: 'vm2' }
          ]
        });

      const strategy = new InfrastructureStrategy();
      const result = await strategy.commands!.providers.handler(mockContext);

      expect(result).toContainEqual({
        provider: 'azure',
        count: 2,
        resources: ['azurerm_virtual_machine', 'Azure::Compute::VirtualMachine']
      });
    });

    it('should detect AWS CloudFormation providers', async () => {
      mockContext.globFiles.mockReturnValue(['template.yaml']);
      mockContext.getMetadata.mockReturnValue({
        tool: 'cloudformation',
        resources: [
          { type: 'AWS::EC2::Instance', name: 'web' },
          { type: 'AWS::S3::Bucket', name: 'data' }
        ]
      });

      const strategy = new InfrastructureStrategy();
      const result = await strategy.commands!.providers.handler(mockContext);

      expect(result).toContainEqual({
        provider: 'aws',
        count: 2,
        resources: ['AWS::EC2::Instance', 'AWS::S3::Bucket']
      });
    });

    it('should detect Google CloudFormation providers', async () => {
      mockContext.globFiles.mockReturnValue(['template.yaml']);
      mockContext.getMetadata.mockReturnValue({
        tool: 'cloudformation',
        resources: [
          { type: 'Google::Compute::Instance', name: 'vm' }
        ]
      });

      const strategy = new InfrastructureStrategy();
      const result = await strategy.commands!.providers.handler(mockContext);

      expect(result).toContainEqual({
        provider: 'google',
        count: 1,
        resources: ['Google::Compute::Instance']
      });
    });

    it('should handle resources with no provider', async () => {
      mockContext.globFiles.mockReturnValue(['deployment.yaml']);
      mockContext.getMetadata.mockReturnValue({
        tool: 'kubernetes',
        resources: [
          { type: 'Deployment', name: 'nginx' },
          { type: 'Service', name: 'nginx-service' }
        ]
      });

      const strategy = new InfrastructureStrategy();
      const result = await strategy.commands!.providers.handler(mockContext);

      // Kubernetes resources don't map to cloud providers
      expect(result).toEqual([]);
    });
  });

  describe('commands - graph', () => {
    it('should generate infrastructure dependency graph', async () => {
      mockContext.globFiles.mockReturnValue(['main.tf']);
      mockContext.getMetadata.mockReturnValue({
        tool: 'terraform',
        resources: [
          { type: 'aws_vpc', name: 'main', dependencies: [] },
          { type: 'aws_subnet', name: 'public', dependencies: ['aws_vpc.main'] },
          { type: 'aws_instance', name: 'web', dependencies: ['aws_subnet.public'] }
        ]
      });

      const strategy = new InfrastructureStrategy();
      const result = await strategy.commands!.graph.handler(mockContext);

      expect(result.nodes).toHaveLength(3);
      expect(result.edges).toHaveLength(2);
      expect(result.edges).toContainEqual({
        from: 'aws_subnet.public',
        to: 'aws_vpc.main'
      });
      expect(result.edges).toContainEqual({
        from: 'aws_instance.web',
        to: 'aws_subnet.public'
      });
    });

    it('should support DOT format output', async () => {
      mockContext.globFiles.mockReturnValue(['main.tf']);
      mockContext.getMetadata.mockReturnValue({
        tool: 'terraform',
        resources: [
          { type: 'aws_vpc', name: 'main', dependencies: [] },
          { type: 'aws_subnet', name: 'public', dependencies: ['aws_vpc.main'] }
        ]
      });

      const strategy = new InfrastructureStrategy();
      const result = await strategy.commands!.graph.handler(mockContext, { format: 'dot' });

      expect(result.format).toBe('dot');
      expect(result.content).toContain('digraph infrastructure');
      expect(result.content).toContain('aws_subnet.public -> aws_vpc.main');
    });
  });

  describe('commands - summary', () => {
    it('should provide infrastructure summary', async () => {
      mockContext.globFiles.mockReturnValue(['main.tf', 'deployment.yaml']);
      mockContext.getMetadata
        .mockReturnValueOnce({
          tool: 'terraform',
          resources: [
            { type: 'aws_instance', name: 'web' },
            { type: 'aws_s3_bucket', name: 'data' }
          ]
        })
        .mockReturnValueOnce({
          tool: 'kubernetes',
          resources: [
            { type: 'Deployment', name: 'nginx' },
            { type: 'Service', name: 'nginx-service' }
          ]
        });

      const strategy = new InfrastructureStrategy();
      const result = await strategy.commands!.summary.handler(mockContext);

      expect(result.tools).toEqual(['terraform', 'kubernetes']);
      expect(result.totalResources).toBe(4);
      expect(result.byTool).toMatchObject({
        terraform: 2,
        kubernetes: 2
      });
    });
  });

  describe('commands - validate', () => {
    it('should detect missing dependencies', async () => {
      mockContext.globFiles.mockReturnValue(['main.tf']);
      mockContext.getMetadata.mockReturnValue({
        tool: 'terraform',
        resources: [
          { type: 'aws_instance', name: 'web', dependencies: ['aws_vpc.main'] }
        ]
      });

      const strategy = new InfrastructureStrategy();
      const result = await strategy.commands!.validate.handler(mockContext);

      expect(result.issues).toBeDefined();
      expect(result.issues.some((i: any) => i.type === 'missing-dependency')).toBe(true);
    });

    it('should detect circular dependencies', async () => {
      mockContext.globFiles.mockReturnValue(['main.tf']);
      mockContext.getMetadata.mockReturnValue({
        tool: 'terraform',
        resources: [
          { type: 'aws_instance', name: 'web', dependencies: ['aws_security_group.sg'] },
          { type: 'aws_security_group', name: 'sg', dependencies: ['aws_instance.web'] }
        ]
      });

      const strategy = new InfrastructureStrategy();
      const result = await strategy.commands!.validate.handler(mockContext);

      expect(result.issues).toBeDefined();
      expect(result.issues.some((i: any) => i.type === 'circular-dependency')).toBe(true);
    });

    it('should report valid configuration with no issues', async () => {
      mockContext.globFiles.mockReturnValue(['main.tf']);
      mockContext.getMetadata.mockReturnValue({
        tool: 'terraform',
        resources: [
          { type: 'aws_vpc', name: 'main', dependencies: [] },
          { type: 'aws_instance', name: 'web', dependencies: ['aws_vpc.main'] }
        ]
      });

      const strategy = new InfrastructureStrategy();
      const result = await strategy.commands!.validate.handler(mockContext);

      expect(result.valid).toBe(true);
      expect(result.issues).toHaveLength(0);
    });
  });

  describe('ignorePatterns', () => {
    it('should ignore common directories', () => {
      const strategy = new InfrastructureStrategy();
      const patterns = strategy.ignorePatterns!();

      expect(patterns).toContain('**/node_modules/**');
      expect(patterns).toContain('**/.terraform/**');
      expect(patterns).toContain('**/.git/**');
    });
  });
});
