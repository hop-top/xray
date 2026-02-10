// __tests__/strategy/infrastructure/parsers/kubernetes.test.ts
import { parseKubernetes, kubernetesTool } from '../../../../src/lib/strategy/infrastructure/parsers/kubernetes';

describe('Kubernetes Parser', () => {
  describe('parseKubernetes', () => {
    it('should parse Deployment manifest', () => {
      const content = `
apiVersion: apps/v1
kind: Deployment
metadata:
  name: nginx-deployment
  labels:
    app: nginx
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
        image: nginx:1.14.2
        ports:
        - containerPort: 80
`;

      const config = parseKubernetes('deployment.yaml', content);

      expect(config.tool).toBe('kubernetes');
      expect(config.resources).toHaveLength(1);
      expect(config.resources[0]).toMatchObject({
        type: 'Deployment',
        name: 'nginx-deployment',
        properties: {
          apiVersion: 'apps/v1',
          replicas: 3
        }
      });
    });

    it('should parse Service manifest', () => {
      const content = `
apiVersion: v1
kind: Service
metadata:
  name: my-service
spec:
  selector:
    app: MyApp
  ports:
    - protocol: TCP
      port: 80
      targetPort: 9376
`;

      const config = parseKubernetes('service.yaml', content);

      expect(config.resources).toHaveLength(1);
      expect(config.resources[0]).toMatchObject({
        type: 'Service',
        name: 'my-service',
        properties: {
          apiVersion: 'v1'
        }
      });
    });

    it('should parse multiple resources from single file', () => {
      const content = `
apiVersion: v1
kind: Service
metadata:
  name: my-service
spec:
  selector:
    app: MyApp
  ports:
    - port: 80
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: my-deployment
spec:
  replicas: 2
`;

      const config = parseKubernetes('app.yaml', content);

      expect(config.resources).toHaveLength(2);
      expect(config.resources[0].type).toBe('Service');
      expect(config.resources[1].type).toBe('Deployment');
    });

    it('should parse ConfigMap', () => {
      const content = `
apiVersion: v1
kind: ConfigMap
metadata:
  name: game-config
data:
  game.properties: |
    enemies=aliens
    lives=3
  ui.properties: |
    color.good=purple
    color.bad=yellow
`;

      const config = parseKubernetes('configmap.yaml', content);

      expect(config.resources[0]).toMatchObject({
        type: 'ConfigMap',
        name: 'game-config'
      });
      expect(config.resources[0].properties?.data).toBeDefined();
    });

    it('should parse Secret', () => {
      const content = `
apiVersion: v1
kind: Secret
metadata:
  name: mysecret
type: Opaque
data:
  username: YWRtaW4=
  password: MWYyZDFlMmU2N2Rm
`;

      const config = parseKubernetes('secret.yaml', content);

      expect(config.resources[0]).toMatchObject({
        type: 'Secret',
        name: 'mysecret',
        properties: {
          type: 'Opaque'
        }
      });
    });

    it('should parse Ingress', () => {
      const content = `
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: minimal-ingress
spec:
  rules:
  - http:
      paths:
      - path: /testpath
        pathType: Prefix
        backend:
          service:
            name: test
            port:
              number: 80
`;

      const config = parseKubernetes('ingress.yaml', content);

      expect(config.resources[0]).toMatchObject({
        type: 'Ingress',
        name: 'minimal-ingress',
        properties: {
          apiVersion: 'networking.k8s.io/v1'
        }
      });
    });

    it('should parse StatefulSet', () => {
      const content = `
apiVersion: apps/v1
kind: StatefulSet
metadata:
  name: web
spec:
  serviceName: "nginx"
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
        image: nginx:1.16
        ports:
        - containerPort: 80
`;

      const config = parseKubernetes('statefulset.yaml', content);

      expect(config.resources[0]).toMatchObject({
        type: 'StatefulSet',
        name: 'web'
      });
    });

    it('should parse DaemonSet', () => {
      const content = `
apiVersion: apps/v1
kind: DaemonSet
metadata:
  name: fluentd-elasticsearch
  namespace: kube-system
spec:
  selector:
    matchLabels:
      name: fluentd-elasticsearch
  template:
    metadata:
      labels:
        name: fluentd-elasticsearch
    spec:
      containers:
      - name: fluentd-elasticsearch
        image: quay.io/fluentd_elasticsearch/fluentd:v2.5.2
`;

      const config = parseKubernetes('daemonset.yaml', content);

      expect(config.resources[0]).toMatchObject({
        type: 'DaemonSet',
        name: 'fluentd-elasticsearch',
        properties: {
          namespace: 'kube-system'
        }
      });
    });

    it('should parse PersistentVolumeClaim', () => {
      const content = `
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: myclaim
spec:
  accessModes:
    - ReadWriteOnce
  resources:
    requests:
      storage: 8Gi
  storageClassName: slow
`;

      const config = parseKubernetes('pvc.yaml', content);

      expect(config.resources[0]).toMatchObject({
        type: 'PersistentVolumeClaim',
        name: 'myclaim'
      });
    });

    it('should parse Namespace', () => {
      const content = `
apiVersion: v1
kind: Namespace
metadata:
  name: production
`;

      const config = parseKubernetes('namespace.yaml', content);

      expect(config.resources[0]).toMatchObject({
        type: 'Namespace',
        name: 'production'
      });
    });

    it('should handle empty YAML', () => {
      const config = parseKubernetes('empty.yaml', '');

      expect(config.tool).toBe('kubernetes');
      expect(config.resources).toEqual([]);
    });

    it('should skip non-Kubernetes YAML', () => {
      const content = `
version: '3'
services:
  web:
    image: nginx
`;

      const config = parseKubernetes('docker-compose.yaml', content);

      expect(config.resources).toEqual([]);
    });

    it('should extract dependencies from references', () => {
      const content = `
apiVersion: apps/v1
kind: Deployment
metadata:
  name: web-app
spec:
  template:
    spec:
      containers:
      - name: app
        image: nginx
        envFrom:
        - configMapRef:
            name: app-config
        - secretRef:
            name: app-secret
`;

      const config = parseKubernetes('deployment.yaml', content);

      expect(config.resources[0].dependencies).toContain('ConfigMap/app-config');
      expect(config.resources[0].dependencies).toContain('Secret/app-secret');
    });

    it('should parse Job', () => {
      const content = `
apiVersion: batch/v1
kind: Job
metadata:
  name: pi
spec:
  template:
    spec:
      containers:
      - name: pi
        image: perl
        command: ["perl", "-Mbignum=bpi", "-wle", "print bpi(2000)"]
      restartPolicy: Never
`;

      const config = parseKubernetes('job.yaml', content);

      expect(config.resources[0]).toMatchObject({
        type: 'Job',
        name: 'pi'
      });
    });

    it('should parse CronJob', () => {
      const content = `
apiVersion: batch/v1
kind: CronJob
metadata:
  name: hello
spec:
  schedule: "*/1 * * * *"
  jobTemplate:
    spec:
      template:
        spec:
          containers:
          - name: hello
            image: busybox
            command: ["/bin/sh", "-c", "date; echo Hello"]
          restartPolicy: OnFailure
`;

      const config = parseKubernetes('cronjob.yaml', content);

      expect(config.resources[0]).toMatchObject({
        type: 'CronJob',
        name: 'hello'
      });
    });
  });

  describe('kubernetesTool', () => {
    it('should detect Kubernetes YAML files', () => {
      const files = [
        'deployment.yaml',
        'service.yml',
        'k8s/ingress.yaml',
        'README.md',
        'package.json'
      ];
      const detected = kubernetesTool.detect(files);

      expect(detected).toEqual([
        'deployment.yaml',
        'service.yml',
        'k8s/ingress.yaml'
      ]);
    });

    it('should return null when no YAML files present', () => {
      const files = ['main.tf', 'README.md', 'index.js'];
      const detected = kubernetesTool.detect(files);

      expect(detected).toBeNull();
    });

    it('should have correct name', () => {
      expect(kubernetesTool.name).toBe('kubernetes');
    });
  });
});
