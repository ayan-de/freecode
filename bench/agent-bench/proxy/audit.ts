export function isModelEndpoint(pathname: string): boolean {
  return /\/(v\d+\/)?(messages|chat\/completions)\/?$/.test(pathname);
}

export interface IsolationAudit {
  ok: boolean;
  modelCalls: number;
  leaks: { method: string; path: string; host: string; status: number }[];
}

/** The proxy log is the list of everything that left. A non-model path is a leak. */
export function audit(
  calls: {
    modelEndpoint: boolean;
    method: string;
    path: string;
    host: string;
    status: number;
  }[],
): IsolationAudit {
  const leaks = calls
    .filter((c) => !c.modelEndpoint)
    .map((c) => ({
      method: c.method,
      path: c.path,
      host: c.host,
      status: c.status,
    }));
  return {
    ok: leaks.length === 0,
    modelCalls: calls.filter((c) => c.modelEndpoint).length,
    leaks,
  };
}
