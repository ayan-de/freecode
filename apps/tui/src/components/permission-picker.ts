import {
  SelectList,
  type SelectItem,
  type SelectListTheme,
} from "@earendil-works/pi-tui";
import type { PermissionPromptDecision } from "@thisisayande/freecode-shared";

export interface PermissionRequestView {
  toolName: string;
  description: string;
  suggestedRule?: string;
  reason?: string;
}

// Renders a permission request's decisions as a SelectList. The tool call
// context rides in the item descriptions (mirrors question-picker rendering).
export function createPermissionPicker(
  request: PermissionRequestView,
  callbacks: {
    onSelect: (decision: PermissionPromptDecision) => void;
    onCancel: () => void;
  },
  theme: SelectListTheme,
): SelectList {
  const what = `${request.toolName}: ${request.description}`;
  const rule = request.suggestedRule;
  const items: SelectItem[] = [
    { label: "Allow once", value: "allow-once", description: what },
    {
      label: "Allow for this session",
      value: "allow-session",
      description: rule ? `Grants ${rule} until the session ends` : what,
    },
    {
      label: "Always allow (this project)",
      value: "allow-project",
      description: rule ? `Saves ${rule} to .freecode/settings.json` : what,
    },
    {
      label: "Always allow (everywhere)",
      value: "allow-always",
      description: rule ? `Saves ${rule} to ~/.freecode/settings.json` : what,
    },
    {
      label: "Deny",
      value: "deny",
      description: request.reason ?? "Block this action",
    },
  ];
  const selector = new SelectList(items, items.length, theme);
  selector.onSelect = async (item: SelectItem) =>
    callbacks.onSelect(item.value as PermissionPromptDecision);
  selector.onCancel = () => callbacks.onCancel();
  return selector;
}
