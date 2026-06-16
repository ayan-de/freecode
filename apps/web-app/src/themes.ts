// Agent mode colors for web-app (CSS hex values)

export type AgentMode = "plan" | "build" | "review" | "explore" | "danger";

export const MODES: AgentMode[] = ["plan", "build", "review", "explore", "danger"];

export const MODE_COLORS_CSS: Record<AgentMode, string> = {
  plan: "#5B9BD5",    // bright blue
  build: "#FFD700",   // bright yellow
  review: "#3CFB3C", // bright green
  explore: "#D92688", // bright magenta
  danger: "#FF4444",  // bright red
};

export const MODE_COLORS_CSS_FG: Record<AgentMode, string> = {
  plan: "#5B9BD5",
  build: "#FFD700",
  review: "#3CFB3C",
  explore: "#D92688",
  danger: "#FF4444",
};
