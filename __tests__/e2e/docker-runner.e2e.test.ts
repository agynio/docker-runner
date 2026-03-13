import { randomUUID } from 'node:crypto';

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { credentials, status } from '@grpc/grpc-js';

import { RunnerServiceGrpcClient, type RunnerServiceGrpcClientInstance } from '../../src/proto/grpc.js';
import { createGrpcTestClient, type GrpcTestClient } from '../helpers/grpc-test-client';

const grpcAddress = process.env.DOCKER_RUNNER_GRPC_URL ?? 'localhost:50051';
const sharedSecret = process.env.DOCKER_RUNNER_SHARED_SECRET;

if (!sharedSecret) {
  throw new Error('DOCKER_RUNNER_SHARED_SECRET is required for e2e tests');
}

describe('docker-runner e2e', () => {
  let client: RunnerServiceGrpcClientInstance;
  let grpcTestClient: GrpcTestClient;
  const startedContainers = new Set<string>();

  beforeAll(async () => {
    client = new RunnerServiceGrpcClient(grpcAddress, credentials.createInsecure());
    grpcTestClient = createGrpcTestClient({ client, secret: sharedSecret });
    await grpcTestClient.ready();
  }, 30_000);

  afterAll(() => {
    client.close();
  });

  afterEach(async () => {
    for (const containerId of startedContainers) {
      try {
        await grpcTestClient.stopContainer(containerId);
      } catch (error) {
        console.warn(`cleanup stop failed for ${containerId}`, error);
      }
      try {
        await grpcTestClient.removeContainer(containerId, { force: true, removeVolumes: true });
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
    const inspect = await grpcTestClient.inspectContainer(containerId);
    expect(inspect.id).toBe(containerId);
    expect(inspect.configImage).toContain('alpine');
  });

  it('stops a running container', async () => {
    const containerId = await startAlpineContainer('stop');
    await grpcTestClient.stopContainer(containerId);
    const inspect = await grpcTestClient.inspectContainer(containerId);
    expect(inspect.id).toBe(containerId);
    expect(inspect.stateRunning).toBe(false);
    expect(inspect.stateStatus).not.toBe('running');
  });

  it('removes a stopped container', async () => {
    const containerId = await startAlpineContainer('remove');
    await grpcTestClient.stopContainer(containerId);
    await grpcTestClient.removeContainer(containerId, { force: true, removeVolumes: true });
    await expect(grpcTestClient.inspectContainer(containerId)).rejects.toMatchObject({ code: status.NOT_FOUND });
  });

  it('runs the full lifecycle', async () => {
    const containerId = await startAlpineContainer('lifecycle');
    const inspect = await grpcTestClient.inspectContainer(containerId);
    expect(inspect.id).toBe(containerId);
    expect(inspect.configImage).toContain('alpine');
    await grpcTestClient.stopContainer(containerId);
    await grpcTestClient.removeContainer(containerId, { force: true, removeVolumes: true });
    await expect(grpcTestClient.inspectContainer(containerId)).rejects.toMatchObject({ code: status.NOT_FOUND });
  });

  it('allows idempotent stop', async () => {
    const containerId = await startAlpineContainer('stop-twice');
    await grpcTestClient.stopContainer(containerId);
    await expect(grpcTestClient.stopContainer(containerId)).resolves.toBeUndefined();
  });

  it('allows idempotent remove', async () => {
    const containerId = await startAlpineContainer('remove-twice');
    await grpcTestClient.stopContainer(containerId);
    await grpcTestClient.removeContainer(containerId, { force: true, removeVolumes: true });
    await expect(
      grpcTestClient.removeContainer(containerId, { force: true, removeVolumes: true }),
    ).resolves.toBeUndefined();
  });

  async function startAlpineContainer(prefix: string): Promise<string> {
    const name = `${prefix}-${randomUUID().slice(0, 8)}`;
    const response = await grpcTestClient.startWorkload({
      image: 'alpine:3.19',
      cmd: ['sleep', '30'],
      name,
      autoRemove: false,
    });
    if (!response?.id) {
      throw new Error('runner start did not return containerId');
    }
    const containerId = response.id;
    startedContainers.add(containerId);
    return containerId;
  }
});
