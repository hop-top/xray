# Infrastructure as Code

Understand cloud resources and infrastructure configuration.

## Goal
Quickly discover what infrastructure resources are defined using Terraform, Kubernetes, Helm, or CloudFormation.

## When to Use
- Onboarding to infrastructure codebase
- Understanding cloud resource dependencies
- Planning infrastructure changes
- Auditing cloud resources
- Understanding deployment targets

## Commands

### List infrastructure resources
```bash
xray infrastructure resources
```
Shows all infrastructure resources from Terraform, Kubernetes, Helm charts, and CloudFormation stacks.

### List cloud providers
```bash
xray infrastructure providers
```
Shows which cloud providers are used (AWS, Google Cloud, Azure).

### Visualize infrastructure dependencies
```bash
xray infrastructure graph
```
Shows resource dependencies.

**Generate visual diagram:**
```bash
xray infrastructure graph --format=dot | dot -Tpng > infra.png
```

### Infrastructure summary
```bash
xray infrastructure summary
```
Shows counts by tool (Terraform, Kubernetes, Helm, CloudFormation).

## Supported Tools

- **Terraform**: `*.tf` files
- **Kubernetes**: YAML manifests (Deployment, Service, ConfigMap, Secret, Ingress, StatefulSet, etc.)
- **Helm**: `Chart.yaml`, `values.yaml`
- **CloudFormation**: `*.template.json`, `*.template.yaml`, AWS SAM templates

## Agent Tips

**Start broad**: Use `infrastructure summary` to see what tools are in use.

**Focus on providers**: Use `infrastructure providers` to understand which clouds are targeted.

**Understand dependencies**: Use `infrastructure graph` to see how resources depend on each other.

**Resource details**: `infrastructure resources` gives you a complete inventory.

## Example Output

```bash
$ xray infrastructure summary
Infrastructure Summary:

Terraform (15 resources):
  - aws_instance: 3
  - aws_security_group: 2
  - aws_s3_bucket: 1

Kubernetes (8 resources):
  - Deployment: 3
  - Service: 3
  - Ingress: 2

$ xray infrastructure providers
Cloud Providers:
  - AWS (Terraform)
  - Google Cloud (Kubernetes)
```
