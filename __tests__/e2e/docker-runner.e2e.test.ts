import { randomUUID } from 'node:crypto';

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { Metadata, credentials, status, type ServiceError } from '@grpc/grpc-js';
import { create } from '@bufbuild/protobuf';

import { buildAuthHeaders } from '../../src/contracts/auth';
import { containerOptsToStartWorkloadRequest } from '../../src/contracts/workload.grpc';
import {
  RUNNER_SERVICE_INSPECT_WORKLOAD_PATH,
  RUNNER_SERVICE_READY_PATH,
  RUNNER_SERVICE_REMOVE_WORKLOAD_PATH,
  RUNNER_SERVICE_START_WORKLOAD_PATH,
  RUNNER_SERVICE_STOP_WORKLOAD_PATH,
  RunnerServiceGrpcClient,
  type RunnerServiceGrpcClientInstance,
} from '../../src/proto/grpc.js';
import {
  InspectWorkloadRequestSchema,
  ReadyRequestSchema,
  RemoveWorkloadRequestSchema,
  StopWorkloadRequestSchema,
  type InspectWorkloadResponse,
  type StartWorkloadResponse,
} from '../../src/proto/gen/agynio/api/runner/v1/runner_pb.js';

const grpcAddress = process.env.DOCKER_RUNNER_GRPC_URL ?? 'localhost:50051';
const sharedSecret = process.env.DOCKER_RUNNER_SHARED_SECRET;

if (!sharedSecret) {
  throw new Error('DOCKER_RUNNER_SHARED_SECRET is required for e2e tests');
}

describe('docker-runner e2e', () => {
  let client: RunnerServiceGrpcClientInstance;
  const startedContainers = new Set<string>();

  beforeAll(async () => {
    client = new RunnerServiceGrpcClient(grpcAddress, credentials.createInsecure());
    await waitForReady();
  }, 30_000);

  afterAll(() => {
    client.close();
  });

  afterEach(async () => {
    for (const containerId of startedContainers) {
      try {
        await stopContainer(containerId);
      } catch (error) {
        console.warn(`cleanup stop failed for ${containerId}`, error);
      }
      try {
        await removeContainer(containerId, { force: true, removeVolumes: true });
      } catch (error) {
        console.warn(`cleanup remove failed for ${containerId}`, error);
      }
    }
    startedContainers.clear();
  });

  it('ready health check', async () => {
    const response = await ready();
    expect(response).toBeDefined();
  });

  it('starts a container', async () => {
    const containerId = await startAlpineContainer('start-only');
    expect(containerId).toBeTruthy();
  });

  it('inspects after start', async () => {
    const containerId = await startAlpineContainer('inspect');
    const inspect = await inspectContainer(containerId);
    expect(inspect.id).toBe(containerId);
    expect(inspect.configImage).toContain('alpine');
  });

  it('stops a running container', async () => {
    const containerId = await startAlpineContainer('stop');
    await stopContainer(containerId);
    const inspect = await inspectContainer(containerId);
    expect(inspect.id).toBe(containerId);
  });

  it('removes a stopped container', async () => {
    const containerId = await startAlpineContainer('remove');
    await stopContainer(containerId);
    await removeContainer(containerId, { force: true, removeVolumes: true });
    await expect(inspectContainer(containerId)).rejects.toMatchObject({ code: status.NOT_FOUND });
  });

  it('runs the full lifecycle', async () => {
    const containerId = await startAlpineContainer('lifecycle');
    const inspect = await inspectContainer(containerId);
    expect(inspect.id).toBe(containerId);
    expect(inspect.configImage).toContain('alpine');
    await stopContainer(containerId);
    await removeContainer(containerId, { force: true, removeVolumes: true });
    await expect(inspectContainer(containerId)).rejects.toMatchObject({ code: status.NOT_FOUND });
  });

  it('allows idempotent stop', async () => {
    const containerId = await startAlpineContainer('stop-twice');
    await stopContainer(containerId);
    await expect(stopContainer(containerId)).resolves.toBeUndefined();
  });

  it('allows idempotent remove', async () => {
    const containerId = await startAlpineContainer('remove-twice');
    await stopContainer(containerId);
    await removeContainer(containerId, { force: true, removeVolumes: true });
    await expect(
      removeContainer(containerId, { force: true, removeVolumes: true }),
    ).resolves.toBeUndefined();
  });

  async function startAlpineContainer(prefix: string): Promise<string> {
    const name = `${prefix}-${randomUUID().slice(0, 8)}`;
    const response = await startWorkload({
      image: 'alpine:3.19',
      cmd: ['sleep', '30'],
      name,
      autoRemove: false,
    });
    if (!response?.containers?.main && !response?.id) {
      throw new Error('runner start did not return containerId');
    }
    const containerId = response.containers?.main ?? response.id;
    startedContainers.add(containerId);
    return containerId;
  }

  async function startWorkload(opts: {
    image: string;
    cmd: string[];
    name: string;
    autoRemove: boolean;
  }): Promise<StartWorkloadResponse> {
    const request = containerOptsToStartWorkloadRequest({
      image: opts.image,
      cmd: opts.cmd,
      name: opts.name,
      autoRemove: opts.autoRemove,
    });
    return unary(RUNNER_SERVICE_START_WORKLOAD_PATH, request, (req, metadata, callback) => {
      client.startWorkload(req, metadata, callback);
    });
  }

  async function stopContainer(containerId: string): Promise<void> {
    const request = create(StopWorkloadRequestSchema, { workloadId: containerId, timeoutSec: 1 });
    await unary(RUNNER_SERVICE_STOP_WORKLOAD_PATH, request, (req, metadata, callback) => {
      client.stopWorkload(req, metadata, callback);
    });
  }

  async function removeContainer(
    containerId: string,
    options: { force?: boolean; removeVolumes?: boolean },
  ): Promise<void> {
    const request = create(RemoveWorkloadRequestSchema, {
      workloadId: containerId,
      force: options.force ?? false,
      removeVolumes: options.removeVolumes ?? false,
    });
    await unary(RUNNER_SERVICE_REMOVE_WORKLOAD_PATH, request, (req, metadata, callback) => {
      client.removeWorkload(req, metadata, callback);
    });
  }

  async function inspectContainer(containerId: string): Promise<InspectWorkloadResponse> {
    const request = create(InspectWorkloadRequestSchema, { workloadId: containerId });
    return unary(RUNNER_SERVICE_INSPECT_WORKLOAD_PATH, request, (req, metadata, callback) => {
      client.inspectWorkload(req, metadata, callback);
    });
  }

  async function ready() {
    const request = create(ReadyRequestSchema, {});
    return unary(RUNNER_SERVICE_READY_PATH, request, (req, metadata, callback) => {
      client.ready(req, metadata, callback);
    });
  }

  function metadataFor(path: string): Metadata {
    const headers = buildAuthHeaders({ method: 'POST', path, body: '', secret: sharedSecret });
    const metadata = new Metadata();
    for (const [key, value] of Object.entries(headers)) {
      metadata.set(key, value);
    }
    return metadata;
  }

  async function unary<Request, Response>(
    path: string,
    request: Request,
    invoke: (
      req: Request,
      metadata: Metadata,
      callback: (err: ServiceError | null, response?: Response) => void,
    ) => void,
  ): Promise<Response> {
    const metadata = metadataFor(path);
    return new Promise<Response>((resolve, reject) => {
      invoke(request, metadata, (err, response) => {
        if (err) {
          reject(err);
          return;
        }
        resolve(response as Response);
      });
    });
  }

  async function waitForReady(): Promise<void> {
    await ready();
  }
});
