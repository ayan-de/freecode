// Random developer/usage tips for TUI welcome box
const tips = [
  "Run 'freecode -help' to see available commands",
  // "Use 'shift+tab' to cycle through agent modes",
  // "Type '/model' to list and select active AI models",
  // "Use '/resume' to pick and continue a previous session",
  // "Press 'Ctrl+C' to exit the TUI securely",
  // "Type '/clear' to wipe the terminal message history",
  //dev pnpm --filter @thisisayande/freecode-core exec tsx src/cli.ts --help
];

export function getRandomTip(): string {
  return tips[Math.floor(Math.random() * tips.length)];
}
