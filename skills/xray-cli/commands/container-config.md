# Container Configuration

Understand Docker and container setup.

## Goal
Quickly understand containerization without reading Dockerfiles and docker-compose.yml files.

## When to Use
- Understanding how app runs in containers
- Learning service architecture
- Planning container changes
- Debugging container issues
- Understanding multi-stage builds

## Commands

### Analyze container setup
```bash
xray container analyze
```
Shows Dockerfile stages, base images, exposed ports, and docker-compose services.

### List services
```bash
xray container services
```
Shows service architecture from docker-compose.yml.

### Show build stages
```bash
xray container stages
```
Shows multi-stage Dockerfile build stages.

## Supported Files

- **Dockerfile**: Dockerfile, *.dockerfile
- **Containerfile**: Containerfile (Podman)
- **docker-compose**: docker-compose.yml, docker-compose.yaml, compose.yml

## Agent Tips

**Start with analyze**: Use `container analyze` for complete overview.

**Multi-stage builds**: Use `container stages` to understand build optimization.

**Service deps**: Use `container services` to see which services depend on others.

## Example Output

```bash
$ xray container analyze
Container Configuration:

Dockerfile (multi-stage):
  Stage 1: builder (node:18-alpine)
    - WORKDIR /app
    - COPY package*.json
    - RUN npm ci
    - RUN npm run build

  Stage 2: production (node:18-alpine)
    - COPY --from=builder /app/dist
    - EXPOSE 3000
    - CMD ["node", "dist/index.js"]

docker-compose.yml (3 services):
  web (custom build)
    Ports: 3000:3000
    Depends on: db, redis

  db (postgres:15)
    Volume: db_data

  redis (redis:7-alpine)

$ xray container services
Service Architecture:

web → db (postgres)
   └→ redis (cache)

Services (3):
  web: Custom build from .
  db: postgres:15 (persistent: db_data)
  redis: redis:7-alpine
```
