import { inject, type InjectionKey } from 'vue';

export type TooltipApi = {
  show: (x: number, y: number, html: string) => void;
  hide: () => void;
};

export const TooltipKey: InjectionKey<TooltipApi> = Symbol('TooltipApi');

const noop: TooltipApi = {
  show: () => undefined,
  hide: () => undefined
};

export function useTooltip(): TooltipApi {
  return inject(TooltipKey, noop);
}
