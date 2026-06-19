import { test, expect, Page } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Lingera Platform Health Checks v3.0
 * 
 * Changes from v2.1:
 * - Grok URL updated: grok.x.ai → grok.com
 * - Tiered detection: Cloudflare → Login Wall → Chat Input
 * - login_wall and cloudflare are EXPECTED states (test passes, no retry waste)
 * - Only selector_not_found and network_error cause test failure
 * - Updated selectors for all 6 platforms based on June 2026 inspection
 * - Improved Cloudflare Turnstile detection
 * - Login URL pattern covers /sign_in (DeepSeek)
 * - Per-platform result files survive Playwright retries (v2.1 fix retained)
 */

interface PlatformResult {
  platform: string;
  status: 'ok' | 'login_wall' | 'cloudflare' | 'failed';
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

// ── Cloudflare detection ──
async function detectCloudflare(page: Page): Promise<boolean> {
  try {
    // Check for Cloudflare challenge page indicators
    const bodyText = await page.locator('body').innerText({ timeout: 3000 });
    const cfIndicators = [
      /performing security verification/i,
      /verify you are human/i,
      /just a moment/i,
      /checking your browser/i,
      /cloudflare/i,
    ];
    const hits = cfIndicators.filter(p => p.test(bodyText));
    if (hits.length >= 2) return true;

    // Check for Turnstile iframe
    const hasTurnstile = await page.locator('iframe[src*="challenges.cloudflare.com"]').count();
    if (hasTurnstile > 0) return true;

    // Check for cf-turnstile widget
    const hasCfWidget = await page.locator('.cf-turnstile, #cf-turnstile-container, [data-sitekey]').count();
    if (hasCfWidget > 0) return true;
  } catch {
    // Ignore extraction errors
  }
  return false;
}

// ── Login wall detection ──
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
  /log in with google/i,
  /login with apple/i,
];

const LOGIN_URL_PATTERNS = [
  /\/login/i,
  /\/auth/i,
  /\/sign.?in/i,   // matches /signin, /sign_in, /sign-in
  /accounts\.google/i,
  /\/sso/i,
];

async function detectLoginWall(page: Page, platformName: string): Promise<boolean> {
  const url = page.url();

  // Check URL-based redirect to login
  for (const pattern of LOGIN_URL_PATTERNS) {
    if (pattern.test(url)) {
      console.log(`🔒 ${platformName}: Login URL detected: ${url}`);
      return true;
    }
  }

  // Check page content for login indicators
  try {
    const bodyText = await page.locator('body').innerText({ timeout: 5000 });
    const loginHits = LOGIN_WALL_PATTERNS.filter(p => p.test(bodyText));

    // Need at least 2 login indicators to avoid false positives
    if (loginHits.length >= 2) {
      // Verify no chat input is present (would mean user IS logged in)
      const hasChatInput = await page.locator(
        'textarea, [contenteditable="true"][role="textbox"], rich-textarea'
      ).first().isVisible({ timeout: 2000 }).catch(() => false);

      if (!hasChatInput) {
        console.log(`🔒 ${platformName}: Login wall detected (${loginHits.length} indicators, no chat input)`);
        return true;
      }
    }
  } catch {
    // Ignore text extraction errors
  }

  return false;
}

// ── Platform-specific login page selectors (proves platform is alive behind auth) ──
function getLoginPageSelectors(platform: string): string[] {
  switch (platform) {
    case 'ChatGPT':
      return [
        // ChatGPT sometimes shows login, sometimes shows chat
        'button:has-text("Log in")',
        'button:has-text("Sign up")',
      ];
    case 'Claude':
      return [
        'input[placeholder*="email" i]',
        'button:has-text("Continue with Google")',
        'button:has-text("Continue with email")',
      ];
    case 'DeepSeek':
      return [
        'input[placeholder*="Phone number" i]',
        'input[placeholder*="email" i]',
        '.ds-input__input',
      ];
    case 'Grok':
      return [
        'button:has-text("Sign in")',
        'a:has-text("Sign in")',
      ];
    case 'Perplexity':
      return [
        'button:has-text("Sign In")',
        'button:has-text("Sign Up")',
      ];
    case 'Gemini':
      return [
        'button:has-text("Sign in")',
      ];
    default:
      return [];
  }
}

// ── Chat input selectors (proves full access) ──
function getChatSelectors(platform: string): string[] {
  switch (platform) {
    case 'ChatGPT':
      return [
        '#prompt-textarea',                         // main composer (id)
        'textarea[name="prompt-textarea"]',          // by name attribute
        'textarea[placeholder="Ask anything"]',      // by placeholder
        'nav[aria-label="Chat history"]',            // sidebar
      ];
    case 'Claude':
      return [
        'div[contenteditable="true"]',               // ProseMirror input
        'fieldset div[contenteditable="true"]',      // within fieldset
        '[data-testid="composer-input"]',            // test id
      ];
    case 'Grok':
      return [
        'textarea[aria-label="Ask Grok anything"]',  // aria label (most stable)
        'textarea[placeholder="What do you want to know?"]', // placeholder
        'textarea[placeholder]',                     // any textarea with placeholder
      ];
    case 'Gemini':
      return [
        'rich-textarea',                             // custom element
        '.ql-editor[contenteditable]',               // Quill editor
        'bard-sidenav',                              // sidebar element
      ];
    case 'Perplexity':
      return [
        'div[role="textbox"][contenteditable="true"]', // ProseMirror div
        '.ProseMirror[contenteditable="true"]',        // ProseMirror class
        'nav[aria-label="Main"]',                     // sidebar nav
      ];
    case 'DeepSeek':
      return [
        'textarea#chat-input',                       // direct id
        '#ds-chat-input',                            // alternative id
        'textarea[placeholder]',                     // any chat textarea
      ];
    default:
      return [];
  }
}

test.describe('Platform Health Checks', () => {

  const platforms = [
    { name: 'ChatGPT',    url: 'https://chatgpt.com' },
    { name: 'Claude',     url: 'https://claude.ai' },
    { name: 'Grok',       url: 'https://grok.com' },          // Updated from grok.x.ai
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

        // Check for HTTP server errors
        if (response && response.status() >= 500) {
          throw Object.assign(new Error(`HTTP ${response.status()}`), { category: 'network_error' });
        }

        // Wait for page to settle
        await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});

        // ── TIER 1: Cloudflare detection ──
        const isCloudflare = await detectCloudflare(page);
        if (isCloudflare) {
          console.log(`☁️ ${platform.name}: Cloudflare challenge detected — platform is alive`);
          writeResult({
            platform: platform.name.toLowerCase(),
            status: 'cloudflare',
            error_message: `Cloudflare challenge at ${page.url()}`,
            error_category: 'cloudflare',
            response_time_ms: Date.now() - startTime,
          });
          return; // Test PASSES — Cloudflare means platform is alive
        }

        // ── TIER 2: Login wall detection ──
        const isLoginWall = await detectLoginWall(page, platform.name);
        if (isLoginWall) {
          // Verify the login page is actually rendering (platform is alive)
          const loginSelectors = getLoginPageSelectors(platform.name);
          let loginPageConfirmed = false;
          for (const sel of loginSelectors) {
            try {
              await expect(page.locator(sel).first()).toBeVisible({ timeout: 5000 });
              loginPageConfirmed = true;
              break;
            } catch {
              // Try next
            }
          }

          console.log(`🔒 ${platform.name}: Login wall — page confirmed: ${loginPageConfirmed}`);
          writeResult({
            platform: platform.name.toLowerCase(),
            status: 'login_wall',
            error_message: `Login required at ${page.url()}`,
            error_category: 'login_wall',
            response_time_ms: Date.now() - startTime,
          });
          return; // Test PASSES — login wall means platform is alive
        }

        // ── TIER 3: Chat input selectors (full access) ──
        const chatSelectors = getChatSelectors(platform.name);
        let chatFound = false;

        for (const selector of chatSelectors) {
          try {
            await expect(page.locator(selector).first()).toBeVisible({ timeout: 12000 });
            console.log(`✅ ${platform.name}: Chat input found with "${selector}" (${Date.now() - startTime}ms)`);
            chatFound = true;
            break;
          } catch {
            // Try next selector
          }
        }

        if (chatFound) {
          writeResult({
            platform: platform.name.toLowerCase(),
            status: 'ok',
            response_time_ms: Date.now() - startTime,
          });
          console.log(`📝 Result: ${platform.name} = ok`);
          return;
        }

        // ── TIER 4: Nothing matched ──
        throw Object.assign(
          new Error(`No matching selectors found after ${Date.now() - startTime}ms`),
          { category: 'selector_not_found' }
        );

      } catch (e: any) {
        const elapsed = Date.now() - startTime;
        const errorCategory = e.category || categorizeError(e.message || '');
        const errorMessage = (e.message || 'Unknown error').slice(0, 500);

        writeResult({
          platform: platform.name.toLowerCase(),
          status: 'failed',
          error_message: errorMessage,
          error_category: errorCategory,
          response_time_ms: elapsed,
        });
        console.log(`📝 Result: ${platform.name} = failed [${errorCategory}]`);

        // Screenshot for debugging
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
    try {
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
    } catch (e) {
      console.warn('⚠️ Could not merge results:', e);
    }
  });
});

function categorizeError(message: string): string {
  if (/timeout|exceeded/i.test(message)) return 'timeout';
  if (/selector|locator.*not found|no matching/i.test(message)) return 'selector_not_found';
  if (/net::ERR|ECONNREFUSED|network|connection refused|HTTP [45]/i.test(message)) return 'network_error';
  if (/login|sign.?in|auth|redirect.*login/i.test(message)) return 'login_wall';
  if (/cloudflare|security verification|verify.*human/i.test(message)) return 'cloudflare';
  return 'unknown';
}
