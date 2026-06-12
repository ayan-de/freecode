// =============================================================================
// Interrupt Handler - Ctrl+C signal handling for session interruption
// PRIMARY: Marks current message as interrupted on single Ctrl+C, force exits on double
// =============================================================================

export interface InterruptState {
  sessionId: string | null;
  messageId: string | null;
  pending: boolean;
}

export class InterruptHandler {
  private sessionId: string | null = null;
  private messageId: string | null = null;

  setActive(sessionId: string, messageId: string): void {
    this.sessionId = sessionId;
    this.messageId = messageId;
  }

  clear(): void {
    this.sessionId = null;
    this.messageId = null;
  }

  getState(): InterruptState {
    return {
      sessionId: this.sessionId,
      messageId: this.messageId,
      pending: this.sessionId !== null,
    };
  }

  setupSignalHandler(
    onInterrupt: (sessionId: string, messageId: string) => void,
  ): void {
    let lastSigInt = 0;
    process.on("SIGINT", () => {
      const now = Date.now();
      if (now - lastSigInt < 1000) {
        // Double Ctrl+C → force exit
        process.exit(1);
      }
      lastSigInt = now;
      if (this.sessionId && this.messageId) {
        onInterrupt(this.sessionId, this.messageId);
      }
    });
  }
}

let globalHandler: InterruptHandler | null = null;

export function getInterruptHandler(): InterruptHandler {
  if (!globalHandler) {
    globalHandler = new InterruptHandler();
  }
  return globalHandler;
}
