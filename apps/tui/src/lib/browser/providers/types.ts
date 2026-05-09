import type { Locator, Page } from 'playwright';

export interface PageAdapter {
  name: string;
  getInputLocator(page: Page): Locator;
  getSubmitButton(page: Page): Locator;
  getResponseLocator(page: Page): Locator;
  isStreaming(page: Page): Promise<boolean>;
  waitForLoadState(page: Page): Promise<void>;
}

export interface ProviderConfig {
  url: string;
  waitForNetworkIdle?: boolean;
}