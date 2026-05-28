// =============================================================================
// ChatGPT Provider Adapter
// =============================================================================

import type { Page, Locator } from 'playwright';
import type { PageAdapter } from './types.js';

export class ChatGPTAdapter implements PageAdapter {
  name = 'chatgpt';

  getInputLocator(page: Page): Locator {
    return page.getByRole('textbox', { name: 'Chat with ChatGPT' }).first();
  }

  async waitForInput(page: Page): Promise<void> {
    await page.getByRole('textbox', { name: 'Chat with ChatGPT' }).first().waitFor({ state: 'visible', timeout: 10000 });
  }

  getSubmitButton(page: Page): Locator {
    return page.locator('button[data-testid="send-button"]').first();
  }

  getResponseLocator(page: Page): Locator {
    return page.locator('div[data-message-author-role="assistant"]').last();
  }

  async isStreaming(page: Page): Promise<boolean> {
    const stopButton = page.locator('button[aria-label="Stop generating"]');
    return stopButton.isVisible().catch(() => false);
  }

  async waitForLoadState(page: Page): Promise<void> {
    await page.waitForLoadState('networkidle');
  }
}