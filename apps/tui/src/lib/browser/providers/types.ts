import type { Page } from 'playwright';

export interface PageAdapter {
  name: string;
  getInputLocator(page: Page): any;
  getSubmitButton(page: Page): any;
  getResponseLocator(page: Page): any;
  isStreaming(page: Page): Promise<boolean>;
  waitForLoadState(page: Page): Promise<void>;
}

export interface ProviderConfig {
  url: string;
  waitForNetworkIdle?: boolean;
}