import type { SelectItem, SelectListTheme } from "@earendil-works/pi-tui";
import chalk from "chalk";
import type {
  ProviderInfo,
  ProviderStatus,
} from "@thisisayande/freecode-shared";
import type { ModelInfo } from "../ipc/client.js";
import { SearchableSelectList } from "./searchable-select-list.js";

const UPDATE_CREDENTIAL = "__update_credential__";

/**
 * Right-hand status column.
 *
 * `ready` is the one that matters: an anonymous web session works with nothing
 * on file, so it is green like any configured provider. Only `needs-setup` is
 * an actual blocker, and it is the only entry that reads as one.
 */
function statusLabel(provider: ProviderInfo): string {
  const status: ProviderStatus =
    provider.status ?? (provider.hasApiKey ? "configured" : "needs-setup");
  switch (status) {
    case "ready":
      return chalk.green("✓ ready") + chalk.dim(" · anonymous");
    case "signed-in":
      return chalk.green("✓ signed in");
    case "configured":
      return chalk.green("✓ configured");
    case "needs-setup":
      return "not configured";
  }
}

export function createProviderSelector(
  providers: ProviderInfo[],
  callbacks: {
    onSelect: (providerId: string) => void;
    onCancel: () => void;
  },
  theme: SelectListTheme,
): SearchableSelectList {
  const providerItems: SelectItem[] = providers.map((p) => ({
    label: p.name,
    value: p.id,
    description: statusLabel(p),
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
    /** Shown as an extra entry when the provider's credential can be changed. */
    onUpdateCredential?: () => void;
    /** Wording for that entry — "API key" for /model, "cookie" for /web. */
    credentialLabel?: string;
    /** True when nothing is on file yet, so the entry offers rather than replaces. */
    credentialMissing?: boolean;
  },
  theme: SelectListTheme,
): SearchableSelectList {
  const modelItems: SelectItem[] = models.map((m: ModelInfo) => ({
    label: m.name || m.id,
    value: m.id,
    description: m.description || m.id,
  }));

  if (callbacks.onUpdateCredential) {
    const noun = callbacks.credentialLabel ?? "API key";
    const entry: SelectItem = {
      label: callbacks.credentialMissing ? `Add ${noun}` : `Update ${noun}`,
      value: UPDATE_CREDENTIAL,
      description: callbacks.credentialMissing
        ? `Store a ${noun} for this provider`
        : `Replace the saved ${noun} for this provider`,
    };
    // An optional credential that is not on file goes LAST. The cursor starts
    // on the first row, so putting "Add cookie" there makes Enter open a
    // credential prompt when the user came to pick a model — and for an
    // anonymous web session that credential is not even needed. Replacing one
    // that already exists stays first, which is where /model has always put it.
    if (callbacks.credentialMissing) modelItems.push(entry);
    else modelItems.unshift(entry);
  }

  const maxVisible = Math.min(modelItems.length, 10);
  const selector = new SearchableSelectList(modelItems, maxVisible, theme);

  selector.onSelect = (item: SelectItem) => {
    if (item.value === UPDATE_CREDENTIAL) {
      callbacks.onUpdateCredential?.();
    } else {
      callbacks.onSelect(item.value);
    }
  };

  selector.onCancel = () => {
    callbacks.onCancel();
  };

  return selector;
}
