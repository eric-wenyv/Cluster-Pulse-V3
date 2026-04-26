import { onBeforeUnmount, onMounted, type Ref } from 'vue';
import { useTooltip } from './useTooltip';

export function useTermTooltips(rootRef: Ref<HTMLElement | null>): void {
  const tooltip = useTooltip();

  function findTermTarget(event: Event): HTMLElement | null {
    const target = event.target as HTMLElement | null;
    return target?.closest<HTMLElement>('[data-term-tooltip]') ?? null;
  }

  function showFromEvent(event: MouseEvent): void {
    const target = findTermTarget(event);
    if (!target) {
      return;
    }
    const label = target.dataset.termLabel;
    const description = target.dataset.termTooltip;
    if (!label || !description) {
      return;
    }
    tooltip.show(event.clientX, event.clientY, `<strong>${label}</strong><br />${description}`);
  }

  function hideFromEvent(event: Event): void {
    const target = findTermTarget(event);
    if (!target) {
      return;
    }
    const related = (event as MouseEvent).relatedTarget as Node | null;
    if (related && target.contains(related)) {
      return;
    }
    tooltip.hide();
  }

  function showFromFocus(event: FocusEvent): void {
    const target = findTermTarget(event);
    if (!target) {
      return;
    }
    const label = target.dataset.termLabel;
    const description = target.dataset.termTooltip;
    if (!label || !description) {
      return;
    }
    const rect = target.getBoundingClientRect();
    tooltip.show(rect.left + rect.width / 2, rect.bottom, `<strong>${label}</strong><br />${description}`);
  }

  function hideFromFocus(event: FocusEvent): void {
    const target = findTermTarget(event);
    if (!target) {
      return;
    }
    tooltip.hide();
  }

  onMounted(() => {
    const root = rootRef.value;
    if (!root) {
      return;
    }
    root.addEventListener('mouseover', showFromEvent);
    root.addEventListener('mousemove', showFromEvent);
    root.addEventListener('mouseout', hideFromEvent);
    root.addEventListener('focusin', showFromFocus);
    root.addEventListener('focusout', hideFromFocus);
  });

  onBeforeUnmount(() => {
    const root = rootRef.value;
    if (!root) {
      return;
    }
    root.removeEventListener('mouseover', showFromEvent);
    root.removeEventListener('mousemove', showFromEvent);
    root.removeEventListener('mouseout', hideFromEvent);
    root.removeEventListener('focusin', showFromFocus);
    root.removeEventListener('focusout', hideFromFocus);
  });
}
