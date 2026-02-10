// __tests__/strategy/infrastructure/parsers/cloudformation.test.ts
import { parseCloudFormation, cloudFormationTool } from '../../../../src/lib/strategy/infrastructure/parsers/cloudformation';

describe('CloudFormation Parser', () => {
  describe('parseCloudFormation - YAML format', () => {
    it('should parse basic CloudFormation template', () => {
      const content = `
AWSTemplateFormatVersion: '2010-09-09'
Description: Simple EC2 instance

Resources:
  MyEC2Instance:
    Type: AWS::EC2::Instance
    Properties:
      ImageId: ami-0c55b159cbfafe1f0
      InstanceType: t2.micro
`;

      const config = parseCloudFormation('template.yaml', content);

      expect(config.tool).toBe('cloudformation');
      expect(config.resources).toHaveLength(1);
      expect(config.resources[0]).toMatchObject({
        type: 'AWS::EC2::Instance',
        name: 'MyEC2Instance',
        properties: {
          ImageId: 'ami-0c55b159cbfafe1f0',
          InstanceType: 't2.micro'
        }
      });
    });

    it('should parse multiple resources', () => {
      const content = `
Resources:
  MyVPC:
    Type: AWS::EC2::VPC
    Properties:
      CidrBlock: 10.0.0.0/16

  MySubnet:
    Type: AWS::EC2::Subnet
    Properties:
      VpcId: !Ref MyVPC
      CidrBlock: 10.0.1.0/24
`;

      const config = parseCloudFormation('template.yaml', content);

      expect(config.resources).toHaveLength(2);
      expect(config.resources[0].type).toBe('AWS::EC2::VPC');
      expect(config.resources[1].type).toBe('AWS::EC2::Subnet');
    });

    it('should parse Parameters', () => {
      const content = `
Parameters:
  InstanceType:
    Type: String
    Default: t2.micro
    AllowedValues:
      - t2.micro
      - t2.small
    Description: EC2 instance type

  KeyName:
    Type: AWS::EC2::KeyPair::KeyName
    Description: Name of an existing EC2 KeyPair

Resources:
  MyInstance:
    Type: AWS::EC2::Instance
    Properties:
      InstanceType: !Ref InstanceType
`;

      const config = parseCloudFormation('template.yaml', content);

      expect(config.variables).toBeDefined();
      expect(config.variables!.InstanceType).toMatchObject({
        Type: 'String',
        Default: 't2.micro'
      });
      expect(config.variables!.KeyName).toMatchObject({
        Type: 'AWS::EC2::KeyPair::KeyName'
      });
    });

    it('should parse Outputs', () => {
      const content = `
Resources:
  MyInstance:
    Type: AWS::EC2::Instance
    Properties:
      ImageId: ami-123

Outputs:
  InstanceId:
    Description: Instance ID
    Value: !Ref MyInstance

  PublicIP:
    Description: Public IP address
    Value: !GetAtt MyInstance.PublicIp
    Export:
      Name: MyInstancePublicIP
`;

      const config = parseCloudFormation('template.yaml', content);

      expect(config.outputs).toBeDefined();
      expect(config.outputs!.InstanceId.Description).toBe('Instance ID');
      expect(config.outputs!.InstanceId.Value).toBeDefined();
      expect(config.outputs!.PublicIP).toMatchObject({
        Description: 'Public IP address'
      });
    });

    it('should parse Conditions', () => {
      const content = `
Parameters:
  Environment:
    Type: String

Conditions:
  IsProduction: !Equals [!Ref Environment, production]
  CreateProdResources: !And
    - !Equals [!Ref Environment, production]
    - !Not [!Equals [!Ref AWS::Region, us-east-1]]

Resources:
  MyBucket:
    Type: AWS::S3::Bucket
    Condition: IsProduction
`;

      const config = parseCloudFormation('template.yaml', content);

      expect(config.resources[0].properties?.Condition).toBe('IsProduction');
    });

    it('should parse Mappings', () => {
      const content = `
Mappings:
  RegionMap:
    us-east-1:
      AMI: ami-0ff8a91507f77f867
    us-west-1:
      AMI: ami-0bdb828fd58c52235
  InstanceTypeMap:
    t2.micro:
      CPU: 1
      Memory: 1

Resources:
  MyInstance:
    Type: AWS::EC2::Instance
    Properties:
      ImageId: !FindInMap [RegionMap, !Ref "AWS::Region", AMI]
`;

      const config = parseCloudFormation('template.yaml', content);

      expect(config.variables).toBeDefined();
      expect(config.variables!.Mappings).toBeDefined();
    });

    it('should detect resource dependencies from Ref', () => {
      const content = `
Resources:
  MyVPC:
    Type: AWS::EC2::VPC
    Properties:
      CidrBlock: 10.0.0.0/16

  MySubnet:
    Type: AWS::EC2::Subnet
    Properties:
      VpcId: !Ref MyVPC
      CidrBlock: 10.0.1.0/24

  MyInstance:
    Type: AWS::EC2::Instance
    Properties:
      SubnetId: !Ref MySubnet
`;

      const config = parseCloudFormation('template.yaml', content);

      expect(config.resources[1].dependencies).toContain('MyVPC');
      expect(config.resources[2].dependencies).toContain('MySubnet');
    });

    it('should detect resource dependencies from GetAtt', () => {
      const content = `
Resources:
  MyLoadBalancer:
    Type: AWS::ElasticLoadBalancing::LoadBalancer
    Properties:
      Listeners: []

  MyRecordSet:
    Type: AWS::Route53::RecordSet
    Properties:
      Name: example.com
      Type: A
      AliasTarget:
        DNSName: !GetAtt MyLoadBalancer.DNSName
`;

      const config = parseCloudFormation('template.yaml', content);

      expect(config.resources[1].dependencies).toContain('MyLoadBalancer');
    });

    it('should detect DependsOn', () => {
      const content = `
Resources:
  MyDB:
    Type: AWS::RDS::DBInstance
    Properties:
      DBName: mydb

  MyApp:
    Type: AWS::EC2::Instance
    DependsOn: MyDB
    Properties:
      ImageId: ami-123
`;

      const config = parseCloudFormation('template.yaml', content);

      expect(config.resources[1].dependencies).toContain('MyDB');
    });
  });

  describe('parseCloudFormation - JSON format', () => {
    it('should parse JSON CloudFormation template', () => {
      const content = `{
  "AWSTemplateFormatVersion": "2010-09-09",
  "Resources": {
    "MyBucket": {
      "Type": "AWS::S3::Bucket",
      "Properties": {
        "BucketName": "my-bucket"
      }
    }
  }
}`;

      const config = parseCloudFormation('template.json', content);

      expect(config.tool).toBe('cloudformation');
      expect(config.resources).toHaveLength(1);
      expect(config.resources[0]).toMatchObject({
        type: 'AWS::S3::Bucket',
        name: 'MyBucket'
      });
    });

    it('should parse JSON with Parameters and Outputs', () => {
      const content = `{
  "Parameters": {
    "BucketName": {
      "Type": "String",
      "Default": "my-default-bucket"
    }
  },
  "Resources": {
    "MyBucket": {
      "Type": "AWS::S3::Bucket"
    }
  },
  "Outputs": {
    "BucketArn": {
      "Value": { "Fn::GetAtt": ["MyBucket", "Arn"] }
    }
  }
}`;

      const config = parseCloudFormation('template.json', content);

      expect(config.variables).toBeDefined();
      expect(config.outputs).toBeDefined();
    });
  });

  describe('parseCloudFormation - AWS SAM', () => {
    it('should parse SAM template', () => {
      const content = `
AWSTemplateFormatVersion: '2010-09-09'
Transform: AWS::Serverless-2016-10-31

Resources:
  MyFunction:
    Type: AWS::Serverless::Function
    Properties:
      Handler: index.handler
      Runtime: nodejs14.x
      CodeUri: ./src
`;

      const config = parseCloudFormation('template.yaml', content);

      expect(config.resources[0]).toMatchObject({
        type: 'AWS::Serverless::Function',
        name: 'MyFunction'
      });
    });

    it('should parse SAM API', () => {
      const content = `
Transform: AWS::Serverless-2016-10-31

Resources:
  MyApi:
    Type: AWS::Serverless::Api
    Properties:
      StageName: prod

  MyFunction:
    Type: AWS::Serverless::Function
    Properties:
      Events:
        ApiEvent:
          Type: Api
          Properties:
            RestApiId: !Ref MyApi
            Path: /hello
            Method: get
`;

      const config = parseCloudFormation('template.yaml', content);

      expect(config.resources[1].dependencies).toContain('MyApi');
    });
  });

  describe('parseCloudFormation - edge cases', () => {
    it('should handle empty template', () => {
      const config = parseCloudFormation('empty.yaml', '');

      expect(config.tool).toBe('cloudformation');
      expect(config.resources).toEqual([]);
    });

    it('should handle template with no Resources', () => {
      const content = `
AWSTemplateFormatVersion: '2010-09-09'
Description: Empty template
`;

      const config = parseCloudFormation('template.yaml', content);

      expect(config.resources).toEqual([]);
    });

    it('should handle Metadata section', () => {
      const content = `
Resources:
  MyInstance:
    Type: AWS::EC2::Instance
    Metadata:
      AWS::CloudFormation::Init:
        config:
          packages:
            yum:
              httpd: []
    Properties:
      ImageId: ami-123
`;

      const config = parseCloudFormation('template.yaml', content);

      expect(config.resources[0].metadata).toBeDefined();
    });
  });

  describe('parseCloudFormation - intrinsic functions', () => {
    it('should handle !Sub intrinsic function', () => {
      const content = `
Resources:
  MyTopic:
    Type: AWS::SNS::Topic
    Properties:
      TopicName: !Sub 'my-topic-\${AWS::StackName}'
`;

      const config = parseCloudFormation('template.yaml', content);

      expect(config.resources).toHaveLength(1);
      expect(config.resources[0].properties?.TopicName).toEqual({
        'Fn::Sub': 'my-topic-${AWS::StackName}'
      });
    });

    it('should handle !Join intrinsic function', () => {
      const content = `
Resources:
  MyBucket:
    Type: AWS::S3::Bucket
    Properties:
      BucketName: !Join ['-', ['my', 'bucket', 'name']]
`;

      const config = parseCloudFormation('template.yaml', content);

      expect(config.resources[0].properties?.BucketName).toEqual({
        'Fn::Join': ['-', ['my', 'bucket', 'name']]
      });
    });

    it('should handle !Equals intrinsic function', () => {
      const content = `
Conditions:
  IsProduction: !Equals [!Ref Environment, 'production']

Resources:
  MyInstance:
    Type: AWS::EC2::Instance
    Properties:
      ImageId: ami-123
`;

      const config = parseCloudFormation('template.yaml', content);

      expect(config.resources).toHaveLength(1);
    });

    it('should handle !And intrinsic function', () => {
      const content = `
Conditions:
  IsProductionAndUsEast: !And
    - !Equals [!Ref Environment, 'production']
    - !Equals [!Ref Region, 'us-east-1']

Resources:
  MyInstance:
    Type: AWS::EC2::Instance
    Properties:
      ImageId: ami-123
`;

      const config = parseCloudFormation('template.yaml', content);

      expect(config.resources).toHaveLength(1);
    });

    it('should handle !Not intrinsic function', () => {
      const content = `
Conditions:
  IsNotProduction: !Not [!Equals [!Ref Environment, 'production']]

Resources:
  MyInstance:
    Type: AWS::EC2::Instance
    Properties:
      ImageId: ami-123
`;

      const config = parseCloudFormation('template.yaml', content);

      expect(config.resources).toHaveLength(1);
    });

    it('should handle !FindInMap intrinsic function', () => {
      const content = `
Mappings:
  RegionMap:
    us-east-1:
      AMI: ami-123
    us-west-2:
      AMI: ami-456

Resources:
  MyInstance:
    Type: AWS::EC2::Instance
    Properties:
      ImageId: !FindInMap [RegionMap, !Ref 'AWS::Region', AMI]
`;

      const config = parseCloudFormation('template.yaml', content);

      expect(config.resources[0].properties?.ImageId).toEqual({
        'Fn::FindInMap': ['RegionMap', { Ref: 'AWS::Region' }, 'AMI']
      });
      expect(config.variables?.Mappings).toBeDefined();
    });

    it('should handle invalid YAML with intrinsic functions', () => {
      const content = `{invalid yaml with !Ref`;

      const config = parseCloudFormation('template.yaml', content);

      expect(config.resources).toEqual([]);
    });

    it('should handle malformed JSON', () => {
      const content = `{invalid json`;

      const config = parseCloudFormation('template.json', content);

      expect(config.resources).toEqual([]);
    });

    it('should handle non-object template', () => {
      const content = `"just a string"`;

      const config = parseCloudFormation('template.yaml', content);

      expect(config.resources).toEqual([]);
    });

    it('should handle DependsOn as array', () => {
      const content = `
Resources:
  MyDB:
    Type: AWS::RDS::DBInstance
    Properties:
      DBName: mydb

  MyCache:
    Type: AWS::ElastiCache::CacheCluster
    Properties:
      CacheNodeType: cache.t2.micro

  MyApp:
    Type: AWS::EC2::Instance
    DependsOn:
      - MyDB
      - MyCache
    Properties:
      ImageId: ami-123
`;

      const config = parseCloudFormation('template.yaml', content);

      expect(config.resources[2].dependencies).toContain('MyDB');
      expect(config.resources[2].dependencies).toContain('MyCache');
    });

    it('should handle resource with Condition property', () => {
      const content = `
Conditions:
  CreateProdResources: !Equals [!Ref Environment, 'production']

Resources:
  MyInstance:
    Type: AWS::EC2::Instance
    Condition: CreateProdResources
    Properties:
      ImageId: ami-123
`;

      const config = parseCloudFormation('template.yaml', content);

      expect(config.resources[0].properties?.Condition).toBe('CreateProdResources');
    });

    it('should skip self-references in dependencies', () => {
      const content = `
Resources:
  MyInstance:
    Type: AWS::EC2::Instance
    Properties:
      ImageId: ami-123
      Tags:
        - Key: Name
          Value: !Ref MyInstance
`;

      const config = parseCloudFormation('template.yaml', content);

      // Should not include MyInstance in its own dependencies
      expect(config.resources).toHaveLength(1);
      if (config.resources[0].dependencies) {
        expect(config.resources[0].dependencies).not.toContain('MyInstance');
      } else {
        // It's ok if dependencies is undefined - that means no deps were found
        expect(config.resources[0].dependencies).toBeUndefined();
      }
    });

    it('should skip AWS pseudo parameters in dependencies', () => {
      const content = `
Resources:
  MyTopic:
    Type: AWS::SNS::Topic
    Properties:
      TopicName: !Sub 'topic-\${AWS::StackName}-\${AWS::Region}'
`;

      const config = parseCloudFormation('template.yaml', content);

      // Should not include AWS:: pseudo parameters as dependencies
      const awsDeps = config.resources[0].dependencies?.filter(d => d.startsWith('AWS::'));
      expect(awsDeps).toBeUndefined();
    });
  });

  describe('cloudFormationTool', () => {
    it('should detect CloudFormation template files', () => {
      const files = [
        'template.yaml',
        'stack.template.json',
        'infra.template.yml',
        'cloudformation.json',
        'README.md'
      ];
      const detected = cloudFormationTool.detect(files);

      expect(detected).toEqual([
        'template.yaml',
        'stack.template.json',
        'infra.template.yml',
        'cloudformation.json'
      ]);
    });

    it('should detect SAM templates', () => {
      const files = [
        'sam.yaml',
        'template.sam.json',
        'serverless.yaml'
      ];
      const detected = cloudFormationTool.detect(files);

      expect(detected).toContain('sam.yaml');
      expect(detected).toContain('template.sam.json');
    });

    it('should return null when no CloudFormation files present', () => {
      const files = ['main.tf', 'deployment.yaml', 'README.md'];
      const detected = cloudFormationTool.detect(files);

      expect(detected).toBeNull();
    });

    it('should have correct name', () => {
      expect(cloudFormationTool.name).toBe('cloudformation');
    });
  });
});
