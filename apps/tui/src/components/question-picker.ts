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
  const items: SelectItem[] = question.options.map((o) => ({
    label: o.label,
    value: o.label,
    description: o.description,
  }));
  const selector = new SelectList(items, Math.min(items.length, 5), theme);
  selector.onSelect = async (item: SelectItem) => callbacks.onSelect(item.value);
  selector.onCancel = () => callbacks.onCancel();
  return selector;
}
