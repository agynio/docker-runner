# docker-runner

Standalone Docker runner service extracted from the agynio/platform monorepo.

## Prerequisites

- Access to an agynio Kubernetes cluster (kubeconfig configured).
- `kubectl`.
- `devspace`.
- No local Node.js or pnpm required; the dev container in the cluster runs the toolchain.

## Cluster Setup

```sh
gh repo clone agynio/bootstrap_v2
cd bootstrap_v2
cp terraform/terraform.tfvars.example terraform/terraform.tfvars
./apply.sh -y
```

## Development (DevSpace)

```sh
cd /path/to/docker-runner
devspace dev
```

DevSpace syncs the repo into the cluster dev container, runs `pnpm install` and
`pnpm proto:generate`, then starts `tsx watch src/service/main.ts` for hot reload.
It also forwards gRPC on port `50051` to your local machine.

## Running Tests

```sh
devspace enter
pnpm test
DOCKER_RUNNER_SHARED_SECRET=change-me pnpm test:e2e
```

`pnpm test` runs unit + integration tests. The e2e suite requires the shared
secret env var shown above.

## Troubleshooting

- **Sync timeout**: if the dev container logs `ERROR: sync timeout`, restart
  `devspace dev` and confirm the repo sync completed before the process starts.
- **ArgoCD reverting changes**: DevSpace disables auto-sync for the
  `docker-runner` ArgoCD app. If it keeps reverting, manually disable
  auto-sync or re-run `devspace dev` to apply the patch again.
- **Docker socket missing**: if `/var/run/docker.sock` is missing in the pod,
  ensure the cluster nodes expose the Docker socket and the deployment mounts it.
- **Port forwarding**: if `50051` is unavailable, confirm `devspace dev` is
  still running and restart it to re-establish the port forward.
