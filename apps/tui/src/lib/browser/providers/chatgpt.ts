import type { Page, Locator } from 'playwright';
import type { PageAdapter } from './types.js';

export class ChatGPTAdapter implements PageAdapter {
  name = 'chatgpt';

  getInputLocator(page: Page): Locator {
    return page.locator('textarea');
  }

  getSubmitButton(page: Page): Locator {
    return page.locator('button[data-testid="send-button"]');
  }

  getResponseLocator(page: Page): Locator {
    return page.locator('[data-testid="turn"]').last();
  }

  async isStreaming(page: Page): Promise<boolean> {
    const stopButton = page.locator('button[aria-label="Stop generating"]');
    return stopButton.isVisible().catch(() => false);
  }

  async waitForLoadState(page: Page): Promise<void> {
    await page.waitForLoadState('networkidle');
  }
}