import type { Page, Browser } from 'playwright';

export interface BrowserController {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  isConnected(): boolean;
  getPage(): Page | null;
}

export interface BrowserConfig {
  cdpUrl?: string;
  headless?: boolean;
}