/**
 * Format a duration in milliseconds into a human-readable string (e.g. 150ms, 6.2s, 1m 15s).
 */
export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const seconds = ms / 1000;
  if (seconds < 60) {
    return `${seconds.toFixed(1)}s`;
  }
  const minutes = Math.floor(seconds / 60);
  const remainingSecs = Math.floor(seconds % 60);
  return `${minutes}m ${remainingSecs}s`;
}

/**
 * Format a duration in seconds into a human-readable string (e.g. 6.2s, 1m 15s).
 */
export function formatDurationSeconds(seconds: number): string {
  if (seconds < 60) {
    return `${seconds.toFixed(1)}s`;
  }
  const minutes = Math.floor(seconds / 60);
  const remainingSecs = Math.floor(seconds % 60);
  return `${minutes}m ${remainingSecs}s`;
}
