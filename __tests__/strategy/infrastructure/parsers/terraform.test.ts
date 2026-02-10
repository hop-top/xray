// __tests__/strategy/infrastructure/parsers/terraform.test.ts
import { parseTerraform, terraformTool } from '../../../../src/lib/strategy/infrastructure/parsers/terraform';

describe('Terraform Parser', () => {
  describe('parseTerraform', () => {
    it('should parse basic resource blocks', () => {
      const content = `
resource "aws_instance" "web" {
  ami           = "ami-0c55b159cbfafe1f0"
  instance_type = "t2.micro"
}
`;

      const config = parseTerraform('main.tf', content);

      expect(config.tool).toBe('terraform');
      expect(config.resources).toHaveLength(1);
      expect(config.resources[0]).toMatchObject({
        type: 'aws_instance',
        name: 'web',
        properties: {
          ami: 'ami-0c55b159cbfafe1f0',
          instance_type: 't2.micro'
        }
      });
    });

    it('should parse multiple resources', () => {
      const content = `
resource "aws_instance" "web" {
  ami = "ami-123"
}

resource "aws_security_group" "allow_http" {
  name = "allow_http"
}
`;

      const config = parseTerraform('main.tf', content);

      expect(config.resources).toHaveLength(2);
      expect(config.resources[0].type).toBe('aws_instance');
      expect(config.resources[1].type).toBe('aws_security_group');
    });

    it('should parse variable blocks', () => {
      const content = `
variable "region" {
  type    = string
  default = "us-west-2"
}

variable "instance_count" {
  type = number
}
`;

      const config = parseTerraform('variables.tf', content);

      expect(config.variables).toBeDefined();
      expect(config.variables!.region).toMatchObject({
        type: 'string',
        default: 'us-west-2'
      });
      expect(config.variables!.instance_count).toMatchObject({
        type: 'number'
      });
    });

    it('should parse output blocks', () => {
      const content = `
output "instance_ip" {
  value = aws_instance.web.public_ip
}

output "instance_id" {
  value       = aws_instance.web.id
  description = "The ID of the instance"
}
`;

      const config = parseTerraform('outputs.tf', content);

      expect(config.outputs).toBeDefined();
      expect(config.outputs!.instance_ip).toMatchObject({
        value: 'aws_instance.web.public_ip'
      });
      expect(config.outputs!.instance_id).toMatchObject({
        value: 'aws_instance.web.id',
        description: 'The ID of the instance'
      });
    });

    it('should parse module blocks', () => {
      const content = `
module "vpc" {
  source = "terraform-aws-modules/vpc/aws"
  version = "3.0.0"

  name = "my-vpc"
  cidr = "10.0.0.0/16"
}
`;

      const config = parseTerraform('main.tf', content);

      expect(config.resources).toHaveLength(1);
      expect(config.resources[0]).toMatchObject({
        type: 'module',
        name: 'vpc',
        properties: {
          source: 'terraform-aws-modules/vpc/aws',
          version: '3.0.0',
          name: 'my-vpc',
          cidr: '10.0.0.0/16'
        }
      });
    });

    it('should parse provider configurations', () => {
      const content = `
provider "aws" {
  region = "us-west-2"
}

provider "google" {
  project = "my-project"
  region  = "us-central1"
}
`;

      const config = parseTerraform('providers.tf', content);

      expect(config.resources).toHaveLength(2);
      expect(config.resources[0].type).toBe('provider');
      expect(config.resources[0].name).toBe('aws');
      expect(config.resources[1].type).toBe('provider');
      expect(config.resources[1].name).toBe('google');
    });

    it('should parse data sources', () => {
      const content = `
data "aws_ami" "ubuntu" {
  most_recent = true
  owners      = ["099720109477"]
}
`;

      const config = parseTerraform('main.tf', content);

      expect(config.resources).toHaveLength(1);
      expect(config.resources[0]).toMatchObject({
        type: 'data.aws_ami',
        name: 'ubuntu'
      });
    });

    it('should parse resource dependencies', () => {
      const content = `
resource "aws_instance" "web" {
  ami           = data.aws_ami.ubuntu.id
  subnet_id     = aws_subnet.main.id
  depends_on    = [aws_security_group.allow_http]
}
`;

      const config = parseTerraform('main.tf', content);

      expect(config.resources[0].dependencies).toContain('data.aws_ami.ubuntu');
      expect(config.resources[0].dependencies).toContain('aws_subnet.main');
      expect(config.resources[0].dependencies).toContain('aws_security_group.allow_http');
    });

    it('should parse nested blocks', () => {
      const content = `
resource "aws_security_group" "allow_http" {
  name = "allow_http"

  ingress {
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}
`;

      const config = parseTerraform('main.tf', content);

      expect(config.resources[0].properties?.ingress).toBeDefined();
      expect(config.resources[0].properties?.egress).toBeDefined();
    });

    it('should parse locals block', () => {
      const content = `
locals {
  environment = "production"
  common_tags = {
    Project = "MyApp"
    Owner   = "DevOps"
  }
}
`;

      const config = parseTerraform('main.tf', content);

      expect(config.variables).toBeDefined();
      expect(config.variables!.environment).toBe('production');
    });

    it('should handle empty file', () => {
      const config = parseTerraform('empty.tf', '');

      expect(config.tool).toBe('terraform');
      expect(config.resources).toEqual([]);
    });

    it('should handle comments', () => {
      const content = `
# This is a comment
resource "aws_instance" "web" {
  ami = "ami-123" # Inline comment
}

/* Multi-line
   comment */
`;

      const config = parseTerraform('main.tf', content);

      expect(config.resources).toHaveLength(1);
      expect(config.resources[0].type).toBe('aws_instance');
    });
  });

  describe('terraformTool', () => {
    it('should detect .tf files', () => {
      const files = ['main.tf', 'variables.tf', 'outputs.tf', 'README.md'];
      const detected = terraformTool.detect(files);

      expect(detected).toEqual(['main.tf', 'variables.tf', 'outputs.tf']);
    });

    it('should return null when no .tf files present', () => {
      const files = ['README.md', 'package.json', 'main.js'];
      const detected = terraformTool.detect(files);

      expect(detected).toBeNull();
    });

    it('should have correct name', () => {
      expect(terraformTool.name).toBe('terraform');
    });
  });
});
