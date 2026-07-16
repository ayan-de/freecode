import type { SelectItem, SelectListTheme } from "@earendil-works/pi-tui";
import chalk from "chalk";
import type { ModelInfo } from "../ipc/client.js";
import { SearchableSelectList } from "./searchable-select-list.js";

const UPDATE_API_KEY = "__update_api_key__";

export function createProviderSelector(
  providers: any[],
  callbacks: {
    onSelect: (providerId: string) => void;
    onCancel: () => void;
  },
  theme: SelectListTheme,
): SearchableSelectList {
  const providerItems: SelectItem[] = providers.map((p: any) => ({
    label: p.name,
    value: p.id,
    description: p.hasApiKey
      ? chalk.green("✓ configured")
      : "not configured",
  }));

  const maxVisible = Math.min(providerItems.length, 10);
  const selector = new SearchableSelectList(providerItems, maxVisible, theme);

  selector.onSelect = (item: SelectItem) => {
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
    /** Shown as an extra entry when the provider already has a saved key. */
    onUpdateApiKey?: () => void;
  },
  theme: SelectListTheme,
): SearchableSelectList {
  const modelItems: SelectItem[] = models.map((m: ModelInfo) => ({
    label: m.name || m.id,
    value: m.id,
    description: m.description || m.id,
  }));

  if (callbacks.onUpdateApiKey) {
    modelItems.unshift({
      label: "Update API key",
      value: UPDATE_API_KEY,
      description: "Replace the saved API key for this provider",
    });
  }

  const maxVisible = Math.min(modelItems.length, 10);
  const selector = new SearchableSelectList(modelItems, maxVisible, theme);

  selector.onSelect = (item: SelectItem) => {
    if (item.value === UPDATE_API_KEY) {
      callbacks.onUpdateApiKey?.();
    } else {
      callbacks.onSelect(item.value);
    }
  };

  selector.onCancel = () => {
    callbacks.onCancel();
  };

  return selector;
}
