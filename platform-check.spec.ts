import { test, expect, Page } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Lingera Platform Health Checks v2.1
 * - Login-wall detection (prevents false positives)
 * - Per-platform granular reporting
 * - Response time measurement
 * - Individual result files per test (survives Playwright retries)
 */

interface PlatformResult {
  platform: string;
  status: 'ok' | 'failed';
  error_message?: string;
  error_category?: string;
  response_time_ms: number;
}

const RESULTS_DIR = path.join(process.cwd(), 'test-results');

// Write each result individually so retries don't overwrite other platforms
function writeResult(result: PlatformResult) {
  fs.mkdirSync(RESULTS_DIR, { recursive: true });
  fs.writeFileSync(
    path.join(RESULTS_DIR, `${result.platform}-result.json`),
    JSON.stringify(result, null, 2)
  );
}

// ── Login wall indicators (shared across platforms) ──
const LOGIN_WALL_PATTERNS = [
  /log\s*in/i,
  /sign\s*in/i,
  /anmelden/i,
  /einloggen/i,
  /create.*account/i,
  /sign\s*up.*free/i,
  /welcome back/i,
  /continue with google/i,
  /continue with apple/i,
  /continue with microsoft/i,
  /SSO/,
];

const LOGIN_URL_PATTERNS = [
  /\/login/i,
  /\/auth/i,
  /\/signin/i,
  /accounts\.google/i,
  /\/sso/i,
];

async function detectLoginWall(page: Page, platformName: string): Promise<boolean> {
  const url = page.url();

  // Check URL-based redirect to login
  for (const pattern of LOGIN_URL_PATTERNS) {
    if (pattern.test(url)) {
      console.warn(`⚠️ ${platformName}: Redirected to login URL: ${url}`);
      return true;
    }
  }

  // Check page content for login indicators
  try {
    const bodyText = await page.locator('body').innerText({ timeout: 5000 });
    const loginHits = LOGIN_WALL_PATTERNS.filter(p => p.test(bodyText));

    // Need at least 2 login indicators to avoid false positives
    if (loginHits.length >= 2) {
      const hasChatInput = await page.locator('textarea, [contenteditable="true"], rich-textarea').first().isVisible({ timeout: 2000 }).catch(() => false);
      if (!hasChatInput) {
        console.warn(`⚠️ ${platformName}: Login wall detected (${loginHits.length} indicators, no chat input)`);
        return true;
      }
    }
  } catch {
    // Ignore text extraction errors
  }

  return false;
}

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
    test(`${platform.name} - health check`, async ({ page }) => {
      const startTime = Date.now();

      try {
        console.log(`🚀 Checking ${platform.name} (${platform.url})...`);

        const response = await page.goto(platform.url, {
          waitUntil: 'domcontentloaded',
          timeout: 30000,
        });

        // Check for HTTP errors
        if (response && response.status() >= 500) {
          throw Object.assign(new Error(`HTTP ${response.status()}`), { category: 'network_error' });
        }

        await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});

        // Login wall check BEFORE selector check
        const isLoginWall = await detectLoginWall(page, platform.name);
        if (isLoginWall) {
          throw Object.assign(
            new Error(`Login wall detected at ${page.url()}`),
            { category: 'login_wall' }
          );
        }

        // Platform-specific selectors (no generic 'main' or 'body' fallbacks!)
        const selectors = getPlatformSelectors(platform.name);
        let success = false;

        for (const selector of selectors) {
          try {
            await expect(page.locator(selector)).toBeVisible({ timeout: 12000 });
            console.log(`✅ ${platform.name}: OK with "${selector}" (${Date.now() - startTime}ms)`);
            success = true;
            break;
          } catch {
            // Try next selector
          }
        }

        if (!success) {
          throw Object.assign(
            new Error(`No matching selectors found`),
            { category: 'selector_not_found' }
          );
        }

        // Success – write individual result file
        const result: PlatformResult = {
          platform: platform.name.toLowerCase(),
          status: 'ok',
          response_time_ms: Date.now() - startTime,
        };
        writeResult(result);
        console.log(`📝 Result saved: ${platform.name} = ok`);

      } catch (e: any) {
        const elapsed = Date.now() - startTime;
        const errorCategory = e.category || categorizeError(e.message || '');
        const errorMessage = (e.message || 'Unknown error').slice(0, 500);

        // Failure – write individual result file
        const result: PlatformResult = {
          platform: platform.name.toLowerCase(),
          status: 'failed',
          error_message: errorMessage,
          error_category: errorCategory,
          response_time_ms: elapsed,
        };
        writeResult(result);
        console.log(`📝 Result saved: ${platform.name} = failed [${errorCategory}]`);

        // Safe screenshot
        try {
          await page.screenshot({
            path: `test-results/${platform.name.toLowerCase()}-failure.png`,
            fullPage: true,
          });
        } catch {
          console.warn(`⚠️ Screenshot failed for ${platform.name}`);
        }

        throw new Error(`${platform.name} check failed [${errorCategory}]: ${errorMessage}`);
      }
    });
  }

  // After all tests: merge individual results into one file for the workflow
  test.afterAll(async () => {
    const files = fs.readdirSync(RESULTS_DIR).filter(f => f.endsWith('-result.json'));
    const merged: PlatformResult[] = [];

    for (const file of files) {
      try {
        const content = fs.readFileSync(path.join(RESULTS_DIR, file), 'utf-8');
        merged.push(JSON.parse(content));
      } catch {
        console.warn(`⚠️ Could not read ${file}`);
      }
    }

    fs.writeFileSync(
      path.join(RESULTS_DIR, 'platform-results.json'),
      JSON.stringify(merged, null, 2)
    );
    console.log(`\n📊 Merged ${merged.length} results into platform-results.json`);
    console.log(JSON.stringify(merged, null, 2));
  });
});

// ── Hardened selectors: NO generic 'main' or 'body' fallbacks ──
function getPlatformSelectors(platform: string): string[] {
  switch (platform) {
    case 'ChatGPT':
      return [
        'textarea[data-id="root"]',
        '#prompt-textarea',
        '[data-message-author-role]',
        'nav[aria-label="Chat history"]',
      ];
    case 'Claude':
      return [
        'div[contenteditable="true"]',
        'fieldset div[contenteditable="true"]',
        'article[data-testid="conversation-turn"]',
      ];
    case 'Grok':
      return [
        'textarea[placeholder]',
        '[data-testid="grok"]',
        'form textarea',
      ];
    case 'Gemini':
      return [
        'rich-textarea',
        '.ql-editor[contenteditable]',
        'bard-sidenav',
      ];
    case 'Perplexity':
      return [
        'textarea[placeholder]',
        'textarea[autofocus]',
        '[data-testid="search-input"]',
      ];
    case 'DeepSeek':
      return [
        'textarea#chat-input',
        'textarea[placeholder]',
        '#ds-chat-input',
      ];
    default:
      return [];
  }
}

function categorizeError(message: string): string {
  if (/timeout|exceeded/i.test(message)) return 'timeout';
  if (/selector|locator.*not found|no matching/i.test(message)) return 'selector_not_found';
  if (/net::ERR|ECONNREFUSED|network|connection refused|HTTP [45]/i.test(message)) return 'network_error';
  if (/login|sign.?in|auth|redirect.*login/i.test(message)) return 'login_wall';
  return 'unknown';
}
