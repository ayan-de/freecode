import { chromium, type Browser, type Page } from 'playwright';
import type { BrowserController, BrowserConfig } from './types.js';
import type { PageAdapter, ProviderDefinition } from './providers/index.js';
import { logger } from '../utils/logger.js';

export class PlaywrightBrowserController implements BrowserController {
  private browser: Browser | null = null;
  private page: Page | null = null;
  private adapter: PageAdapter | null = null;
  private config: Required<BrowserConfig>;

  constructor(config: BrowserConfig = {}) {
    this.config = {
      cdpUrl: config.cdpUrl || process.env.CDP_URL || 'http://localhost:9222',
      headless: config.headless ?? false,
    };
  }

  setAdapter(adapter: PageAdapter): void {
    this.adapter = adapter;
  }

  async connect(): Promise<void> {
    try {
      logger.info('Connecting to Chrome via CDP', { url: this.config.cdpUrl });
      this.browser = await chromium.connectOverCDP(this.config.cdpUrl);
      const context = this.browser.contexts()[0];
      this.page = context.pages()[0] || await context.newPage();
      logger.info('Browser connected successfully');
    } catch (error) {
      logger.error('Failed to connect to Chrome', { error: String(error) });
      throw new Error(
        `Failed to connect to Chrome at ${this.config.cdpUrl}. ` +
        'Ensure Chrome is running with: chrome --remote-debugging-port=9222'
      );
    }
  }

  async disconnect(): Promise<void> {
    if (this.browser) {
      logger.info('Disconnecting browser');
      await this.browser.close();
      this.browser = null;
      this.page = null;
    }
  }

  isConnected(): boolean {
    return this.browser !== null && this.page !== null;
  }

  getPage(): Page | null {
    return this.page;
  }

  async navigate(provider: ProviderDefinition): Promise<void> {
    if (!this.page) throw new Error('Not connected');
    await this.page.goto(provider.config.url);
    await provider.adapter.waitForLoadState(this.page);
    this.adapter = provider.adapter;
  }

  async sendPrompt(prompt: string): Promise<void> {
    if (!this.page || !this.adapter) {
      throw new Error('Not connected or adapter not set');
    }
    const input = this.adapter.getInputLocator(this.page);
    await input.fill(prompt);
    const submitButton = this.adapter.getSubmitButton(this.page);
    await submitButton.click();
  }

  async waitForResponse(): Promise<string> {
    if (!this.page || !this.adapter) {
      throw new Error('Not connected or adapter not set');
    }

    logger.debug('Waiting for streaming to complete');
    while (await this.adapter.isStreaming(this.page)) {
      await this.page.waitForTimeout(500);
    }

    await this.page.waitForTimeout(1000);

    const responseLocator = this.adapter.getResponseLocator(this.page);
    return responseLocator.innerText();
  }

  async executePrompt(prompt: string): Promise<string> {
    await this.sendPrompt(prompt);
    return this.waitForResponse();
  }
}