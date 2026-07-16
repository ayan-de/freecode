import {
  SelectList,
  decodeKittyPrintable,
  getKeybindings,
  type Component,
  type SelectItem,
  type SelectListTheme,
} from "@earendil-works/pi-tui";
import chalk from "chalk";

/**
 * A SelectList with a type-to-search line above it.
 *
 * Printable characters build a query that substring-matches item labels and
 * values; arrows/enter/escape are forwarded to the underlying list.
 */
export class SearchableSelectList implements Component {
  private allItems: SelectItem[];
  private list: SelectList;
  private query = "";
  private maxVisible: number;
  private theme: SelectListTheme;

  onSelect?: (item: SelectItem) => void;
  onCancel?: () => void;

  constructor(items: SelectItem[], maxVisible: number, theme: SelectListTheme) {
    this.allItems = items;
    this.maxVisible = maxVisible;
    this.theme = theme;
    this.list = this.buildList(items);
  }

  private buildList(items: SelectItem[]): SelectList {
    const list = new SelectList(items, this.maxVisible, this.theme);
    list.onSelect = (item) => this.onSelect?.(item);
    list.onCancel = () => this.onCancel?.();
    return list;
  }

  private applyQuery(): void {
    const q = this.query.toLowerCase();
    const matched = q
      ? this.allItems.filter(
          (item) =>
            item.label.toLowerCase().includes(q) ||
            item.value.toLowerCase().includes(q),
        )
      : this.allItems;
    this.list = this.buildList(matched);
  }

  handleInput(data: string): void {
    const kb = getKeybindings();

    if (kb.matches(data, "tui.editor.deleteCharBackward")) {
      if (this.query) {
        this.query = this.query.slice(0, -1);
        this.applyQuery();
      }
      return;
    }

    if (
      kb.matches(data, "tui.select.up") ||
      kb.matches(data, "tui.select.down") ||
      kb.matches(data, "tui.select.confirm") ||
      kb.matches(data, "tui.select.cancel")
    ) {
      this.list.handleInput(data);
      return;
    }

    const kittyPrintable = decodeKittyPrintable(data);
    const printable =
      kittyPrintable !== undefined
        ? kittyPrintable
        : isPrintable(data)
          ? data
          : undefined;
    if (printable) {
      this.query += printable;
      this.applyQuery();
    }
  }

  invalidate(): void {
    this.list.invalidate();
  }

  render(width: number): string[] {
    const searchLine = this.query
      ? `  ${chalk.dim("Search:")} ${this.query}`
      : `  ${chalk.dim("Type to search, ↑/↓ to select, Enter to confirm")}`;
    return [searchLine, ...this.list.render(width)];
  }
}

function isPrintable(data: string): boolean {
  if (data.length === 0) return false;
  return [...data].every((ch) => {
    const code = ch.charCodeAt(0);
    return code >= 32 && code !== 0x7f && (code < 0x80 || code > 0x9f);
  });
}
