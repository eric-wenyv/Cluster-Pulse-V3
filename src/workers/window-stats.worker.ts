import type {
  WindowStatsComputeRequest,
  WindowStatsInitRequest,
  WindowStatsPayload,
  WindowStatsWorkerRequest,
  WindowStatsWorkerResponse
} from './window-stats-protocol';

let gridBytes: Uint8Array | null = null;
let missingValue = 255;
let metricCount = 0;
let machineCount = 0;
let binCount = 0;

type WorkerContext = {
  onmessage: ((event: MessageEvent<WindowStatsWorkerRequest>) => void) | null;
  postMessage: (response: WindowStatsWorkerResponse, transfer?: Transferable[]) => void;
};

const ctx = self as unknown as WorkerContext;

ctx.onmessage = (event: MessageEvent<WindowStatsWorkerRequest>) => {
  const request = event.data;
  try {
    if (request.type === 'init') {
      handleInit(request);
      return;
    }
    handleCompute(request);
  } catch (error) {
    postResponse({
      type: 'error',
      requestId: request.requestId,
      message: error instanceof Error ? error.message : 'Unknown worker error'
    });
  }
};

function handleInit(request: WindowStatsInitRequest): void {
  gridBytes = request.gridBytes;
  missingValue = request.missingValue;
  metricCount = request.metricCount;
  machineCount = request.machineCount;
  binCount = request.binCount;
  postResponse({ type: 'ready', requestId: request.requestId });
}

function handleCompute(request: WindowStatsComputeRequest): void {
  if (!gridBytes) {
    throw new Error('Window stats worker has not been initialized.');
  }
  const startBin = Math.max(0, Math.min(binCount - 1, request.timeWindow[0]));
  const endBin = Math.max(startBin, Math.min(binCount - 1, request.timeWindow[1]));
  const candidateCount = request.filteredMachineIndices.length;

  const rows: Array<{
    machineIndex: number;
    averages: number[];
    counts: number[];
    peaks: number[];
    peakMetricIndex: number;
    windowPeak: number;
    peakValue: number;
  }> = [];

  for (let candidateIndex = 0; candidateIndex < candidateCount; candidateIndex += 1) {
    const machineIndex = request.filteredMachineIndices[candidateIndex];
    if (machineIndex < 0 || machineIndex >= machineCount) {
      continue;
    }

    const sums = new Array<number>(metricCount).fill(0);
    const counts = new Array<number>(metricCount).fill(0);
    const peaks = new Array<number>(metricCount).fill(0);
    let peakMetricIndex = 0;
    let peakValue = -1;

    for (let binIndex = startBin; binIndex <= endBin; binIndex += 1) {
      for (let metricIndex = 0; metricIndex < metricCount; metricIndex += 1) {
        const value = gridValue(metricIndex, binIndex, machineIndex);
        if (value === missingValue) {
          continue;
        }
        sums[metricIndex] += value;
        counts[metricIndex] += 1;
        peaks[metricIndex] = Math.max(peaks[metricIndex], value);
        if (value > peakValue) {
          peakValue = value;
          peakMetricIndex = metricIndex;
        }
      }
    }

    const allCounts = counts.reduce((sum, count) => sum + count, 0);
    if (allCounts === 0) {
      continue;
    }

    rows.push({
      machineIndex,
      averages: sums.map((sum, metricIndex) => (counts[metricIndex] === 0 ? 0 : sum / counts[metricIndex])),
      counts,
      peaks,
      peakMetricIndex,
      windowPeak: Math.max(peakValue, 0),
      peakValue
    });
  }

  rows.sort((left, right) => {
    const peakDelta = right.peaks[request.metricIndex] - left.peaks[request.metricIndex];
    if (peakDelta !== 0) {
      return peakDelta;
    }
    const averageDelta = right.averages[request.metricIndex] - left.averages[request.metricIndex];
    if (averageDelta !== 0) {
      return averageDelta;
    }
    return right.windowPeak - left.windowPeak;
  });

  postStats(request.requestId, buildPayload(rows));
}

function gridValue(metricIndex: number, binIndex: number, machineIndex: number): number {
  if (!gridBytes) {
    return missingValue;
  }
  return gridBytes[metricIndex * binCount * machineCount + binIndex * machineCount + machineIndex];
}

function buildPayload(
  rows: Array<{
    machineIndex: number;
    averages: number[];
    counts: number[];
    peaks: number[];
    peakMetricIndex: number;
    windowPeak: number;
    peakValue: number;
  }>
): WindowStatsPayload {
  const rowCount = rows.length;
  const machineIndices = new Int32Array(rowCount);
  const averages = new Float32Array(rowCount * metricCount);
  const counts = new Uint32Array(rowCount * metricCount);
  const peaks = new Uint8Array(rowCount * metricCount);
  const peakMetricIndices = new Uint8Array(rowCount);
  const windowPeaks = new Uint8Array(rowCount);
  const peakValues = new Int16Array(rowCount);

  rows.forEach((row, rowIndex) => {
    machineIndices[rowIndex] = row.machineIndex;
    peakMetricIndices[rowIndex] = row.peakMetricIndex;
    windowPeaks[rowIndex] = row.windowPeak;
    peakValues[rowIndex] = row.peakValue;
    for (let metricIndex = 0; metricIndex < metricCount; metricIndex += 1) {
      const offset = rowIndex * metricCount + metricIndex;
      averages[offset] = row.averages[metricIndex];
      counts[offset] = row.counts[metricIndex];
      peaks[offset] = row.peaks[metricIndex];
    }
  });

  return {
    machineIndices,
    averages,
    counts,
    peaks,
    peakMetricIndices,
    windowPeaks,
    peakValues,
    metricCount
  };
}

function postStats(requestId: number, payload: WindowStatsPayload): void {
  const response: WindowStatsWorkerResponse = { type: 'stats', requestId, payload };
  ctx.postMessage(response, [
    payload.machineIndices.buffer,
    payload.averages.buffer,
    payload.counts.buffer,
    payload.peaks.buffer,
    payload.peakMetricIndices.buffer,
    payload.windowPeaks.buffer,
    payload.peakValues.buffer
  ]);
}

function postResponse(response: WindowStatsWorkerResponse): void {
  ctx.postMessage(response);
}
