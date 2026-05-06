export type WindowStatsInitRequest = {
  type: 'init';
  requestId: number;
  gridBytes: Uint8Array;
  missingValue: number;
  metricCount: number;
  machineCount: number;
  binCount: number;
};

export type WindowStatsComputeRequest = {
  type: 'compute';
  requestId: number;
  metricIndex: number;
  timeWindow: [number, number];
  filteredMachineIndices: Int32Array;
};

export type WindowStatsWorkerRequest = WindowStatsInitRequest | WindowStatsComputeRequest;

export type WindowStatsPayload = {
  machineIndices: Int32Array;
  averages: Float32Array;
  counts: Uint32Array;
  peaks: Uint8Array;
  peakMetricIndices: Uint8Array;
  windowPeaks: Uint8Array;
  peakValues: Int16Array;
  metricCount: number;
};

export type WindowStatsReadyResponse = {
  type: 'ready';
  requestId: number;
};

export type WindowStatsResultResponse = {
  type: 'stats';
  requestId: number;
  payload: WindowStatsPayload;
};

export type WindowStatsErrorResponse = {
  type: 'error';
  requestId: number;
  message: string;
};

export type WindowStatsWorkerResponse =
  | WindowStatsReadyResponse
  | WindowStatsResultResponse
  | WindowStatsErrorResponse;
