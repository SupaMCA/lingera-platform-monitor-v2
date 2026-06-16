import { test, expect } from '@playwright/test';

test.describe('Platform Health Checks', () => {

  const platforms = [
    { name: 'ChatGPT',    url: 'https://chatgpt.com' },
    { name: 'Claude',     url: 'https://claude.ai' },
    { name: 'Grok',       url: 'https://grok.x.ai' },
    { name: 'Gemini',     url: 'https://gemini.google.com' },
    { name: 'Perplexity', url: 'https://www.perplexity.ai' },
    { name: 'DeepSeek',   url: 'https://chat.deepseek.com' },
  ];

  for (const platform of platforms) {
    test(`${platform.name} - basic load check`, async ({ page }) => {
      console.log(`🚀 Checking ${platform.name}...`);

      // Navigate with generous timeout
      await page.goto(platform.url, { 
        waitUntil: 'domcontentloaded',
        timeout: 30000 
      });

      // Wait for network to settle
      await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});

      const selectors = getPlatformSelectors(platform.name);
      let success = false;

      for (const selector of selectors) {
        try {
          await expect(page.locator(selector)).toBeVisible({ timeout: 12000 });
          console.log(`✅ ${platform.name}: OK with selector "${selector}"`);
          success = true;
          break;
        } catch (e) {
          // Try next selector
        }
      }

      if (!success) {
        console.error(`❌ ${platform.name} failed all selectors`);
        
        // Safe screenshot
        try {
          await page.screenshot({ 
            path: `test-results/${platform.name.toLowerCase()}-failure.png`, 
            fullPage: true 
          });
        } catch (screenshotError) {
          console.warn(`⚠️ Screenshot failed for ${platform.name}`);
        }

        throw new Error(`${platform.name} check failed`);
      }
    });
  }
});

// Robust selectors per platform
function getPlatformSelectors(platform: string): string[] {
  switch (platform) {
    case 'ChatGPT':
      return [
        'textarea[data-id="root"]',
        'main',
        '[data-message-author-role]',
        '[data-testid^="conversation-turn"]',
        'nav[aria-label="Chat history"]'
      ];
    case 'Claude':
      return [
        'div[contenteditable="true"]',
        'article[data-testid="conversation-turn"]',
        '[data-testid="chat-title-button"]'
      ];
    case 'Grok':
      return [
        'textarea[placeholder]',
        'main',
        '[data-testid*="message"]'
      ];
    case 'Gemini':
      return [
        'rich-textarea',
        'ms-prompt-input-wrapper',
        'main'
      ];
    case 'Perplexity':
      return [
        'textarea[placeholder]',
        '[class*="ThreadTitle"]',
        'main'
      ];
    case 'DeepSeek':
      return [
        'textarea#chat-input',
        'textarea[placeholder]',
        '.ds-markdown',
        'main'
      ];
    default:
      return ['main', 'body'];
  }
}
