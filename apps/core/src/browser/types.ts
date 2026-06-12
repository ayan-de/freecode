// =============================================================================
// Browser Controller Interface
// =============================================================================

import type { Page, Browser } from "playwright";

export interface BrowserController {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  isConnected(): boolean;
  getPage(): Page | null;
  navigate(provider: unknown): Promise<void>;
  sendPrompt(prompt: string): Promise<void>;
  waitForResponse(): Promise<string>;
  executePrompt(prompt: string): Promise<string>;
}

export interface BrowserConfig {
  cdpUrl?: string;
  headless?: boolean;
}
