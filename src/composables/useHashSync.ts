import { onMounted, onUnmounted, watch } from 'vue';
import { METRIC_ORDER } from '../core/constants';
import type { MetricId } from '../core/types';
import { clampWindow } from '../core/utils';
import { useVisualizationStore } from '../stores/visualization';

const METRIC_SET = new Set<MetricId>(METRIC_ORDER);

function buildHash(state: {
  metricId: MetricId;
  timeWindow: [number, number];
  activeDomainId: string | null;
  selectedMachineIndex: number | null;
}): string {
  const params = new URLSearchParams();
  params.set('m', state.metricId);
  params.set('w', `${state.timeWindow[0]},${state.timeWindow[1]}`);
  if (state.activeDomainId) {
    params.set('fd', state.activeDomainId);
  }
  if (state.selectedMachineIndex != null) {
    params.set('mi', String(state.selectedMachineIndex));
  }
  return `#${params.toString()}`;
}

function parseHash(raw: string): URLSearchParams | null {
  if (!raw || raw === '#') {
    return null;
  }
  return new URLSearchParams(raw.startsWith('#') ? raw.slice(1) : raw);
}

export function useHashSync(): void {
  const store = useVisualizationStore();
  let suppressedHash: string | null = null;
  let writeFrame = 0;

  function applyFromHash(): void {
    const data = store.data;
    if (!data) {
      return;
    }
    const params = parseHash(window.location.hash);
    if (!params) {
      return;
    }

    const metricRaw = params.get('m');
    if (metricRaw && METRIC_SET.has(metricRaw as MetricId) && metricRaw !== store.metricId) {
      store.setMetric(metricRaw as MetricId);
    }

    const windowRaw = params.get('w');
    if (windowRaw) {
      const parts = windowRaw.split(',').map((part) => Number.parseInt(part, 10));
      if (parts.length === 2 && parts.every((value) => Number.isFinite(value))) {
        const next = clampWindow([parts[0], parts[1]] as [number, number], data.manifest.binCount);
        if (next[0] !== store.timeWindow[0] || next[1] !== store.timeWindow[1]) {
          store.setTimeWindow(next);
        }
      }
    }

    const domainRaw = params.get('fd');
    if (domainRaw) {
      const exists = data.domains.domains.some((domain) => domain.domainId === domainRaw);
      if (exists && store.activeDomainId !== domainRaw) {
        store.setActiveDomain(domainRaw);
      }
    } else if (store.activeDomainId !== null) {
      store.setActiveDomain(null);
    }

    const machineRaw = params.get('mi');
    if (machineRaw) {
      const machineIndex = Number.parseInt(machineRaw, 10);
      const exists =
        Number.isFinite(machineIndex) &&
        data.machines.machines.some((machine) => machine.index === machineIndex);
      if (exists && store.selectedMachineIndex !== machineIndex) {
        store.setSelectedMachine(machineIndex);
      }
    }
  }

  function scheduleWrite(): void {
    if (writeFrame) {
      return;
    }
    writeFrame = window.requestAnimationFrame(() => {
      writeFrame = 0;
      const next = buildHash({
        metricId: store.metricId,
        timeWindow: store.timeWindow,
        activeDomainId: store.activeDomainId,
        selectedMachineIndex: store.selectedMachineIndex
      });
      if (next === window.location.hash) {
        return;
      }
      suppressedHash = next;
      window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}${next}`);
    });
  }

  function onHashChange(): void {
    if (suppressedHash !== null && window.location.hash === suppressedHash) {
      suppressedHash = null;
      return;
    }
    suppressedHash = null;
    applyFromHash();
  }

  let stopDataWatch: (() => void) | null = null;
  let stopWatch: (() => void) | null = null;

  onMounted(() => {
    window.addEventListener('hashchange', onHashChange);

    // Delay the initial hash application and write loop until data is loaded.
    // This ensures deep-link parameters are applied before any hash write,
    // and avoids overwriting the incoming URL hash with defaults.
    stopDataWatch = watch(
      () => store.data,
      (data) => {
        if (!data) {
          return;
        }
        try {
          applyFromHash();
          stopWatch = watch(
            () =>
              [store.metricId, store.timeWindow[0], store.timeWindow[1], store.activeDomainId, store.selectedMachineIndex] as const,
            () => {
              scheduleWrite();
            },
            { flush: 'post' }
          );
          scheduleWrite();
        } finally {
          stopDataWatch?.();
          stopDataWatch = null;
        }
      },
      { immediate: true }
    );
  });

  onUnmounted(() => {
    if (writeFrame) {
      window.cancelAnimationFrame(writeFrame);
      writeFrame = 0;
    }
    stopDataWatch?.();
    stopWatch?.();
    window.removeEventListener('hashchange', onHashChange);
  });
}
