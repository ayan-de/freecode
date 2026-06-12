import {
  SelectList,
  type SelectItem,
  type SelectListTheme,
} from "@earendil-works/pi-tui";
import type { ModelInfo } from "../ipc/client.js";

export function createProviderSelector(
  providers: any[],
  callbacks: {
    onSelect: (providerId: string) => void;
    onCancel: () => void;
  },
  theme: SelectListTheme,
): SelectList {
  const hasApiKeyMap: Record<string, boolean> = {};
  for (const p of providers) {
    hasApiKeyMap[p.id] = p.hasApiKey;
  }

  const providerItems: SelectItem[] = providers.map((p: any) => ({
    label: p.name,
    value: p.id,
    description: hasApiKeyMap[p.id] ? "(configured)" : "(not configured)",
  }));

  const maxVisible = Math.min(providerItems.length, 5);
  const selector = new SelectList(providerItems, maxVisible, theme);

  selector.onSelect = async (item: SelectItem) => {
    callbacks.onSelect(item.value);
  };

  selector.onCancel = () => {
    callbacks.onCancel();
  };

  return selector;
}

export function createModelSelector(
  models: ModelInfo[],
  callbacks: {
    onSelect: (modelId: string) => void;
    onCancel: () => void;
  },
  theme: SelectListTheme,
): SelectList {
  const modelItems: SelectItem[] = models.map((m: ModelInfo) => ({
    label: m.name || m.id,
    value: m.id,
    description: m.description || m.id,
  }));

  const maxVisible = Math.min(modelItems.length, 5);
  const selector = new SelectList(modelItems, maxVisible, theme);

  selector.onSelect = async (item: SelectItem) => {
    callbacks.onSelect(item.value);
  };

  selector.onCancel = () => {
    callbacks.onCancel();
  };

  return selector;
}
