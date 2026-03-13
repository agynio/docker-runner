# docker-runner

Standalone Docker runner service extracted from the agynio/platform monorepo.

## Development

```sh
pnpm install
pnpm proto:generate
pnpm lint
pnpm build
pnpm test
```

## Docker

```sh
docker build -t ghcr.io/agynio/docker-runner .
```
