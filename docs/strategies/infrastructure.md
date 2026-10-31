# Infrastructure Strategy

## Overview

The Infrastructure Strategy provides unified analysis and validation for infrastructure-as-code across multiple tools: Terraform, Kubernetes, Helm, and CloudFormation. It helps answer "What infrastructure does this project need?" by parsing configuration files and extracting resources, dependencies, and metadata.

## Supported Tools

### Terraform (*.tf)
- **Adoption**: 70%
- **Detects**: resource blocks, modules, providers, data sources, variables, outputs, locals
- **Dependencies**: Extracted from `depends_on`, `Ref` patterns, and `Fn::GetAtt`

### Kubernetes (*.yaml, *.yml)
- **Adoption**: 60%
- **Detects**: Deployments, Services, ConfigMaps, Secrets, Ingress, StatefulSets, DaemonSets, Jobs, CronJobs, PVCs, Namespaces
- **Dependencies**: Extracted from ConfigMapRef, SecretRef

### Helm (Chart.yaml, values.yaml)
- **Adoption**: 40%
- **Detects**: Chart definitions, chart dependencies, values
- **Dependencies**: Chart dependencies with versions

### CloudFormation (*.template.json, *.template.yaml)
- **Adoption**: 30%
- **Detects**: Resources, Parameters, Outputs, Mappings, Conditions
- **Dependencies**: Extracted from `!Ref`, `!GetAtt`, `DependsOn`
- **Intrinsic Functions**: Supports `!Sub`, `!Join`, `!Equals`, `!And`, `!Not`, `!FindInMap`

## Commands

### resources

List all infrastructure resources with optional filtering.

```bash
# List all resources
xray infrastructure resources

# Filter by resource type
xray infrastructure resources --type aws_instance

# Filter by tool
xray infrastructure resources --tool terraform

# Filter by provider
xray infrastructure resources --provider aws

# Filters combine (logical AND); machine-readable output
xray infrastructure resources --tool terraform --provider aws --format json
```

**Options:**
- `--type`: Filter by resource type (e.g., `aws_instance`, `Deployment`)
- `--tool`: Filter by tool (`terraform`, `kubernetes`, `helm`, `cloudformation`)
- `--provider`: Filter by cloud provider (`aws`, `google`, `azure`)

Values are matched exactly. A filter that matches nothing, or an unknown
tool/provider value, is not an error: the result is empty (`(none found)` in
text, `[]` in JSON) and the exit code is 0.

**Output:**
```json
[
  {
    "type": "aws_instance",
    "name": "web",
    "tool": "terraform",
    "file": "main.tf",
    "properties": {
      "ami": "ami-0c55b159cbfafe1f0",
      "instance_type": "t2.micro"
    },
    "dependencies": ["aws_vpc.main", "aws_security_group.allow_http"]
  }
]
```

### providers

List all cloud providers used in the infrastructure.

```bash
xray infrastructure providers
```

**Output:**
```json
[
  {
    "provider": "aws",
    "count": 5,
    "resources": ["aws_instance", "aws_s3_bucket", "aws_vpc", "aws_subnet", "aws_security_group"]
  },
  {
    "provider": "google",
    "count": 2,
    "resources": ["google_compute_instance", "google_storage_bucket"]
  }
]
```

### graph

Generate an infrastructure dependency graph.

```bash
# Default JSON format
xray infrastructure graph

# DOT format (for Graphviz)
xray infrastructure graph --format dot > infra.dot
dot -Tpng infra.dot -o infra.png
```

**Options:**
- `--format`: Output format (`json` or `dot`)

**Output (JSON):**
```json
{
  "nodes": [
    {
      "id": "aws_vpc.main",
      "label": "main",
      "type": "aws_vpc",
      "tool": "terraform"
    },
    {
      "id": "aws_subnet.public",
      "label": "public",
      "type": "aws_subnet",
      "tool": "terraform"
    }
  ],
  "edges": [
    {
      "from": "aws_subnet.public",
      "to": "aws_vpc.main"
    }
  ]
}
```

**Output (DOT):**
```dot
digraph infrastructure {
  aws_subnet.public -> aws_vpc.main
  aws_instance.web -> aws_subnet.public
}
```

### summary

Get a high-level summary of infrastructure.

```bash
xray infrastructure summary
```

**Output:**
```json
{
  "tools": ["terraform", "kubernetes"],
  "totalResources": 15,
  "byTool": {
    "terraform": 8,
    "kubernetes": 7
  }
}
```

### validate

Validate infrastructure configuration for common issues.

```bash
xray infrastructure validate
```

**Checks:**
- Missing dependencies
- Circular dependencies
- (Future: Naming conventions, security misconfigurations, cost estimates)

**Output:**
```json
{
  "valid": false,
  "issues": [
    {
      "type": "missing-dependency",
      "severity": "error",
      "resource": "aws_instance.web",
      "dependency": "aws_vpc.main",
      "file": "main.tf",
      "message": "Resource aws_instance.web depends on aws_vpc.main which is not defined"
    },
    {
      "type": "circular-dependency",
      "severity": "error",
      "resource": "aws_instance.web",
      "dependency": "aws_security_group.sg",
      "file": "main.tf",
      "message": "Circular dependency detected: aws_instance.web -> aws_security_group.sg"
    }
  ],
  "resourceCount": 12
}
```

## Examples

### Example 1: Terraform AWS Infrastructure

**main.tf:**
```hcl
resource "aws_vpc" "main" {
  cidr_block = "10.0.0.0/16"

  tags = {
    Name = "main-vpc"
  }
}

resource "aws_subnet" "public" {
  vpc_id     = aws_vpc.main.id
  cidr_block = "10.0.1.0/24"

  tags = {
    Name = "public-subnet"
  }
}

resource "aws_instance" "web" {
  ami           = data.aws_ami.ubuntu.id
  instance_type = "t2.micro"
  subnet_id     = aws_subnet.public.id

  tags = {
    Name = "web-server"
  }
}

data "aws_ami" "ubuntu" {
  most_recent = true
  owners      = ["099720109477"]

  filter {
    name   = "name"
    values = ["ubuntu/images/hvm-ssd/ubuntu-focal-20.04-amd64-server-*"]
  }
}
```

**Commands:**
```bash
# List all resources
$ xray infrastructure resources
Found 4 resources

# List only instances
$ xray infrastructure resources --type aws_instance

# Show dependency graph
$ xray infrastructure graph --format dot
digraph infrastructure {
  aws_subnet.public -> aws_vpc.main
  aws_instance.web -> aws_subnet.public
  aws_instance.web -> data.aws_ami.ubuntu
}

# Validate
$ xray infrastructure validate
✓ Valid configuration with no issues
```

### Example 2: Kubernetes Deployment

**deployment.yaml:**
```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: app-config
data:
  DATABASE_HOST: postgres.example.com
  DATABASE_PORT: "5432"
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: nginx
spec:
  replicas: 3
  selector:
    matchLabels:
      app: nginx
  template:
    metadata:
      labels:
        app: nginx
    spec:
      containers:
      - name: nginx
        image: nginx:1.21
        envFrom:
        - configMapRef:
            name: app-config
---
apiVersion: v1
kind: Service
metadata:
  name: nginx-service
spec:
  type: LoadBalancer
  selector:
    app: nginx
  ports:
  - port: 80
    targetPort: 80
```

**Commands:**
```bash
# List all Kubernetes resources
$ xray infrastructure resources --tool kubernetes

# Show summary
$ xray infrastructure summary
{
  "tools": ["kubernetes"],
  "totalResources": 3,
  "byTool": {
    "kubernetes": 3
  }
}
```

### Example 3: Mixed Infrastructure

A real-world project might use multiple tools:

```
project/
├── terraform/
│   ├── main.tf          # AWS VPC, subnets, EKS cluster
│   ├── variables.tf
│   └── outputs.tf
├── k8s/
│   ├── deployment.yaml  # Application deployments
│   └── service.yaml     # Services
└── helm/
    ├── Chart.yaml       # Helm chart
    └── values.yaml      # Configuration values
```

**Commands:**
```bash
# List all infrastructure
$ xray infrastructure resources
Found 25 resources across 3 tools

# Show providers
$ xray infrastructure providers
[
  { "provider": "aws", "count": 8, "resources": [...] }
]

# Validate everything
$ xray infrastructure validate
✓ Valid configuration with no issues
```

## File Type Detection

The strategy automatically detects infrastructure files based on patterns:

| Tool | File Patterns |
|------|---------------|
| Terraform | `*.tf` |
| Kubernetes | `*.yaml`, `*.yml` (with Kubernetes API objects) |
| Helm | `Chart.yaml`, `values.yaml`, `values*.yaml` |
| CloudFormation | `*.template.json`, `*.template.yaml`, files containing "cloudformation", "template", or "sam" |

## Ignore Patterns

The following directories are automatically ignored:
- `**/node_modules/**`
- `**/.terraform/**`
- `**/.git/**`
- `**/vendor/**`

## Provider Detection

Cloud providers are automatically detected from resource types:

| Provider | Terraform Prefix | CloudFormation Prefix |
|----------|------------------|----------------------|
| AWS | `aws_*` | `AWS::*` |
| Google Cloud | `google_*` | `Google::*` |
| Azure | `azurerm_*` | `Azure::*` |

## Troubleshooting

### Issue: Resources not detected

**Cause**: File might not match expected patterns.

**Solution**:
- For Terraform, ensure files end with `.tf`
- For Kubernetes, ensure YAML has proper `apiVersion` and `kind` fields
- For Helm, ensure files are named `Chart.yaml` or `values.yaml`
- For CloudFormation, ensure files contain `Resources` section

### Issue: Dependencies not showing

**Cause**: Dependencies might use non-standard patterns.

**Solution**:
- For Terraform, use explicit `depends_on` or standard reference patterns
- For Kubernetes, ensure ConfigMapRef/SecretRef are properly defined
- For CloudFormation, use `!Ref` or `!GetAtt` intrinsic functions

### Issue: Validation reports false positives

**Cause**: Resources might be in separate files not yet analyzed.

**Solution**: Ensure all infrastructure files are in the project directory and not in ignored paths.

## Performance Considerations

- **Large projects**: The strategy efficiently handles projects with 100+ infrastructure files
- **Caching**: Parsed configurations are cached during analysis
- **Parallel processing**: Files are processed in parallel where possible

## Future Enhancements

Planned features for future releases:
- **Cost estimation**: Estimate monthly costs based on resource types
- **Security scanning**: Detect common security misconfigurations
- **Best practices**: Check for compliance with best practices
- **Multi-cloud**: Enhanced support for multi-cloud deployments
- **Drift detection**: Compare actual vs. declared infrastructure
- **Impact analysis**: Show what resources would be affected by changes

## Related Strategies

- **Container Strategy**: Analyzes Dockerfiles and container configurations
- **CICD Strategy**: Analyzes deployment pipelines
- **Config Strategy**: Analyzes application configuration files

## Contributing

To contribute improvements to the infrastructure strategy:

1. Add tests in `__tests__/strategies/infrastructure.test.ts` or `__tests__/strategy/infrastructure/parsers/`
2. Implement features in `strategies/infrastructure.ts` or `src/lib/strategy/infrastructure/parsers/`
3. Update this documentation
4. Ensure all tests pass and coverage remains above 90%

See [CONTRIBUTING.md](../../CONTRIBUTING.md) for guidelines.
