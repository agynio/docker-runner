import fs from 'node:fs';
import { randomUUID } from 'node:crypto';

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { Server, ServerCredentials, credentials } from '@grpc/grpc-js';

import type { RunnerConfig } from '../src/service/config';
import { ContainerService } from '../src';
import { createRunnerGrpcServer } from '../src/service/grpc/server';
import { RunnerServiceGrpcClient } from '../src/proto/grpc.js';
import { createGrpcTestClient, type GrpcTestClient } from './helpers/grpc-test-client';

const DEFAULT_SOCKET = process.env.DOCKER_SOCKET ?? '/var/run/docker.sock';
const hasSocket = fs.existsSync(DEFAULT_SOCKET);
const hasDockerHost = Boolean(process.env.DOCKER_HOST);
const shouldSkip = process.env.SKIP_DOCKER_RUNNER_E2E === '1' || (!hasSocket && !hasDockerHost);

const describeOrSkip = shouldSkip ? describe.skip : describe;

if (shouldSkip) {
  const reason = process.env.SKIP_DOCKER_RUNNER_E2E === '1'
    ? 'SKIP_DOCKER_RUNNER_E2E was explicitly set'
    : 'No Docker socket found and DOCKER_HOST is not defined';
  console.warn(`Skipping docker-runner docker-backed integration tests: ${reason}`);
}

describeOrSkip('docker-runner docker-backed container lifecycle', () => {
  let grpcAddress: string;
  let client: InstanceType<typeof RunnerServiceGrpcClient>;
  let grpcTestClient: GrpcTestClient;
  let shutdown: (() => Promise<void>) | null = null;
  const startedContainers = new Set<string>();

  beforeAll(async () => {
    const config: RunnerConfig = {
      dockerSocket: hasSocket ? DEFAULT_SOCKET : '',
      logLevel: 'error',
      grpcHost: '127.0.0.1',
      grpcPort: 0,
    };
    const previousSocket = process.env.DOCKER_SOCKET;
    if (config.dockerSocket) {
      process.env.DOCKER_SOCKET = config.dockerSocket;
    }
    const containers = new ContainerService();
    const server = createRunnerGrpcServer({ config, containers });
    const address = await bindServer(server, config.grpcHost);
    grpcAddress = address;
    client = new RunnerServiceGrpcClient(address, credentials.createInsecure());
    grpcTestClient = createGrpcTestClient({ client });
    await grpcTestClient.ready();
    shutdown = async () => {
      await new Promise<void>((resolve) => {
        server.tryShutdown((err) => {
          if (err) {
            server.forceShutdown();
          }
          resolve();
        });
      });
      client.close();
      if (previousSocket !== undefined) {
        process.env.DOCKER_SOCKET = previousSocket;
      } else {
        delete process.env.DOCKER_SOCKET;
      }
    };
  }, 30_000);

  afterAll(async () => {
    if (shutdown) {
      await shutdown();
      shutdown = null;
    }
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

  it('starts, inspects, stops, and removes a real container', async () => {
    const containerId = await startAlpineContainer('delete-once');

    const inspect = await grpcTestClient.inspectContainer(containerId);
    expect(inspect.id).toBe(containerId);
    expect(inspect.configImage).toContain('alpine');

    await deleteContainer(containerId);

    await expect(grpcTestClient.inspectContainer(containerId)).rejects.toMatchObject({ code: 5 });
  }, 120_000);

  it('allows delete operations to be invoked twice without failing', async () => {
    const containerId = await startAlpineContainer('delete-twice');

    await deleteContainer(containerId);
    await expect(grpcTestClient.stopContainer(containerId)).resolves.toBeUndefined();
    await expect(
      grpcTestClient.removeContainer(containerId, { force: true, removeVolumes: true }),
    ).resolves.toBeUndefined();
  }, 120_000);

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

  async function deleteContainer(containerId: string): Promise<void> {
    await grpcTestClient.stopContainer(containerId);
    await grpcTestClient.removeContainer(containerId, { force: true, removeVolumes: true });
    startedContainers.delete(containerId);
  }
});

async function bindServer(server: Server, host: string): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    server.bindAsync(`${host}:0`, ServerCredentials.createInsecure(), (err, port) => {
      if (err) return reject(err);
      resolve(`${host}:${port}`);
    });
  });
}
