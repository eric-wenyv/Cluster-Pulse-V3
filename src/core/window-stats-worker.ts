import { METRIC_ORDER } from './constants';
import type { AppData, GridData, MetricId, WindowMachineStat } from './types';
import type { WindowStatsPayload, WindowStatsWorkerRequest, WindowStatsWorkerResponse } from '../workers/window-stats-protocol';

type PendingRequest = {
  resolve: () => void;
  reject: (error: Error) => void;
};

type PendingStatsRequest = {
  resolve: (payload: WindowStatsPayload) => void;
  reject: (error: Error) => void;
};

export class WindowStatsWorkerClient {
  private worker: Worker | null = null;
  private requestId = 0;
  private initializedGridKey = '';
  private pending = new Map<number, PendingRequest | PendingStatsRequest>();

  async compute(params: {
    data: AppData;
    grid: GridData;
    metricId: MetricId;
    timeWindow: [number, number];
    filteredMachineIndices: number[];
  }): Promise<WindowMachineStat[]> {
    if (typeof Worker === 'undefined') {
      throw new Error('Web Worker is not available in this browser.');
    }
    const worker = this.ensureWorker();
    await this.ensureInitialized(worker, params.grid);
    const requestId = this.nextRequestId();
    const filteredMachineIndices = Int32Array.from(params.filteredMachineIndices);
    const payload = await new Promise<WindowStatsPayload>((resolve, reject) => {
      this.pending.set(requestId, { resolve, reject });
      const request: WindowStatsWorkerRequest = {
        type: 'compute',
        requestId,
        metricIndex: metricIndex(params.metricId),
        timeWindow: params.timeWindow,
        filteredMachineIndices
      };
      worker.postMessage(request, [filteredMachineIndices.buffer]);
    });
    return hydrateWindowStats(params.data, payload);
  }

  terminate(): void {
    this.worker?.terminate();
    this.worker = null;
    this.initializedGridKey = '';
    this.rejectPending(new Error('Window stats worker was terminated.'));
  }

  private ensureWorker(): Worker {
    if (this.worker) {
      return this.worker;
    }
    const worker = new Worker(new URL('../workers/window-stats.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (event: MessageEvent<WindowStatsWorkerResponse>) => this.handleMessage(event.data);
    worker.onerror = (event) => {
      this.rejectPending(new Error(event.message || 'Window stats worker failed.'));
      this.terminate();
    };
    this.worker = worker;
    return worker;
  }

  private async ensureInitialized(worker: Worker, grid: GridData): Promise<void> {
    const gridKey = `${grid.machineCount}:${grid.binCount}:${grid.metricCount}:${grid.missingValue}:${grid.bytes.byteLength}`;
    if (this.initializedGridKey === gridKey) {
      return;
    }
    const requestId = this.nextRequestId();
    const gridBytes = new Uint8Array(grid.bytes);
    await new Promise<void>((resolve, reject) => {
      this.pending.set(requestId, { resolve, reject });
      const request: WindowStatsWorkerRequest = {
        type: 'init',
        requestId,
        gridBytes,
        missingValue: grid.missingValue,
        metricCount: grid.metricCount,
        machineCount: grid.machineCount,
        binCount: grid.binCount
      };
      worker.postMessage(request, [gridBytes.buffer]);
    });
    this.initializedGridKey = gridKey;
  }

  private handleMessage(response: WindowStatsWorkerResponse): void {
    const pending = this.pending.get(response.requestId);
    if (!pending) {
      return;
    }
    this.pending.delete(response.requestId);
    if (response.type === 'error') {
      pending.reject(new Error(response.message));
      return;
    }
    if (response.type === 'ready') {
      (pending as PendingRequest).resolve();
      return;
    }
    (pending as PendingStatsRequest).resolve(response.payload);
  }

  private rejectPending(error: Error): void {
    this.pending.forEach((pending) => pending.reject(error));
    this.pending.clear();
  }

  private nextRequestId(): number {
    this.requestId += 1;
    return this.requestId;
  }
}

export function hydrateWindowStats(data: AppData, payload: WindowStatsPayload): WindowMachineStat[] {
  const stats: WindowMachineStat[] = [];
  const metricCount = payload.metricCount;

  for (let rowIndex = 0; rowIndex < payload.machineIndices.length; rowIndex += 1) {
    const machineIndex = payload.machineIndices[rowIndex];
    const machine = data.machines.machines[machineIndex];
    if (!machine) {
      continue;
    }
    stats.push({
      machineIndex,
      machine,
      domainId: machine.failureDomain1,
      averages: {
        cpu: payload.averages[rowIndex * metricCount + 0] ?? 0,
        memory: payload.averages[rowIndex * metricCount + 1] ?? 0,
        network: payload.averages[rowIndex * metricCount + 2] ?? 0,
        disk: payload.averages[rowIndex * metricCount + 3] ?? 0
      },
      counts: {
        cpu: payload.counts[rowIndex * metricCount + 0] ?? 0,
        memory: payload.counts[rowIndex * metricCount + 1] ?? 0,
        network: payload.counts[rowIndex * metricCount + 2] ?? 0,
        disk: payload.counts[rowIndex * metricCount + 3] ?? 0
      },
      peaks: {
        cpu: payload.peaks[rowIndex * metricCount + 0] ?? 0,
        memory: payload.peaks[rowIndex * metricCount + 1] ?? 0,
        network: payload.peaks[rowIndex * metricCount + 2] ?? 0,
        disk: payload.peaks[rowIndex * metricCount + 3] ?? 0
      },
      peakMetric: METRIC_ORDER[payload.peakMetricIndices[rowIndex] ?? 0] ?? 'cpu',
      windowPeak: payload.windowPeaks[rowIndex] ?? 0,
      peakValue: payload.peakValues[rowIndex] ?? -1
    });
  }

  return stats;
}

function metricIndex(metricId: MetricId): number {
  const index = METRIC_ORDER.indexOf(metricId);
  return index < 0 ? 0 : index;
}
