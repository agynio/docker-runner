import { Metadata, type ServiceError } from '@grpc/grpc-js';
import { create } from '@bufbuild/protobuf';

import { containerOptsToStartWorkloadRequest } from '../../src/contracts/workload.grpc';
import {
  RUNNER_SERVICE_INSPECT_WORKLOAD_PATH,
  RUNNER_SERVICE_READY_PATH,
  RUNNER_SERVICE_REMOVE_WORKLOAD_PATH,
  RUNNER_SERVICE_START_WORKLOAD_PATH,
  RUNNER_SERVICE_STOP_WORKLOAD_PATH,
  type RunnerServiceGrpcClientInstance,
} from '../../src/proto/grpc.js';
import {
  InspectWorkloadRequestSchema,
  ReadyRequestSchema,
  RemoveWorkloadRequestSchema,
  StopWorkloadRequestSchema,
  type InspectWorkloadResponse,
  type ReadyResponse,
  type StartWorkloadResponse,
} from '../../src/proto/gen/agynio/api/runner/v1/runner_pb.js';

export type StartWorkloadInput = {
  image: string;
  cmd: string[];
  name: string;
  autoRemove: boolean;
};

export type GrpcTestClient = {
  metadataFor: (path: string) => Metadata;
  unary: <Request, Response>(
    path: string,
    request: Request,
    invoke: (
      req: Request,
      metadata: Metadata,
      callback: (err: ServiceError | null, response?: Response) => void,
    ) => void,
  ) => Promise<Response>;
  startWorkload: (opts: StartWorkloadInput) => Promise<StartWorkloadResponse>;
  stopContainer: (containerId: string, timeoutSec?: number) => Promise<void>;
  removeContainer: (
    containerId: string,
    options?: { force?: boolean; removeVolumes?: boolean },
  ) => Promise<void>;
  inspectContainer: (containerId: string) => Promise<InspectWorkloadResponse>;
  ready: () => Promise<ReadyResponse>;
};

export function createGrpcTestClient(options: {
  client: RunnerServiceGrpcClientInstance;
}): GrpcTestClient {
  const { client } = options;

  const metadataFor = (path: string): Metadata => {
    return new Metadata();
  };

  const unary = async <Request, Response>(
    path: string,
    request: Request,
    invoke: (
      req: Request,
      metadata: Metadata,
      callback: (err: ServiceError | null, response?: Response) => void,
    ) => void,
  ): Promise<Response> => {
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
  };

  const startWorkload = async (opts: StartWorkloadInput): Promise<StartWorkloadResponse> => {
    const request = containerOptsToStartWorkloadRequest({
      image: opts.image,
      cmd: opts.cmd,
      name: opts.name,
      autoRemove: opts.autoRemove,
    });
    return unary(RUNNER_SERVICE_START_WORKLOAD_PATH, request, (req, metadata, callback) => {
      client.startWorkload(req, metadata, callback);
    });
  };

  const stopContainer = async (containerId: string, timeoutSec = 1): Promise<void> => {
    const request = create(StopWorkloadRequestSchema, { workloadId: containerId, timeoutSec });
    await unary(RUNNER_SERVICE_STOP_WORKLOAD_PATH, request, (req, metadata, callback) => {
      client.stopWorkload(req, metadata, callback);
    });
  };

  const removeContainer = async (
    containerId: string,
    options: { force?: boolean; removeVolumes?: boolean } = {},
  ): Promise<void> => {
    const request = create(RemoveWorkloadRequestSchema, {
      workloadId: containerId,
      force: options.force ?? false,
      removeVolumes: options.removeVolumes ?? false,
    });
    await unary(RUNNER_SERVICE_REMOVE_WORKLOAD_PATH, request, (req, metadata, callback) => {
      client.removeWorkload(req, metadata, callback);
    });
  };

  const inspectContainer = async (containerId: string): Promise<InspectWorkloadResponse> => {
    const request = create(InspectWorkloadRequestSchema, { workloadId: containerId });
    return unary(RUNNER_SERVICE_INSPECT_WORKLOAD_PATH, request, (req, metadata, callback) => {
      client.inspectWorkload(req, metadata, callback);
    });
  };

  const ready = async (): Promise<ReadyResponse> => {
    const request = create(ReadyRequestSchema, {});
    return unary(RUNNER_SERVICE_READY_PATH, request, (req, metadata, callback) => {
      client.ready(req, metadata, callback);
    });
  };

  return {
    metadataFor,
    unary,
    startWorkload,
    stopContainer,
    removeContainer,
    inspectContainer,
    ready,
  };
}
