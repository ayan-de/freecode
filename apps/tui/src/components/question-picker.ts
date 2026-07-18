import {
  SelectList,
  type SelectItem,
  type SelectListTheme,
} from "@earendil-works/pi-tui";
import type { QuestionSpec } from "@thisisayande/freecode-shared";

// Renders one question's options as a SelectList. onSelect returns the chosen
// option label (answers are matched by label — see the question tool output).
export function createQuestionPicker(
  question: QuestionSpec,
  callbacks: { onSelect: (label: string) => void; onCancel: () => void },
  theme: SelectListTheme,
): SelectList {
  // Options come from unvalidated model output, so an option may be missing
  // its `label` (or be null). pi-tui's SelectList crashes on an undefined
  // display value (label || value), so coerce every item to a real string and
  // drop options with nothing renderable at all.
  const items: SelectItem[] = (question.options ?? [])
    .filter((o): o is NonNullable<typeof o> => o != null)
    .map((o) => {
      const label =
        typeof o.label === "string" && o.label.length > 0
          ? o.label
          : (o.description ?? "");
      return { label, value: label, description: o.description };
    })
    .filter((item) => item.label.length > 0);
  const selector = new SelectList(items, Math.min(items.length, 5), theme);
  selector.onSelect = async (item: SelectItem) => callbacks.onSelect(item.value);
  selector.onCancel = () => callbacks.onCancel();
  return selector;
}
