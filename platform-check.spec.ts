import { test, expect, type Browser, type Page } from "@playwright/test";
import * as fs from "fs";
import * as path from "path";
import { collectDiagnostics, inspectPage } from "./src/detect";
import { readStructureSnapshot } from "./src/dom-snapshot";
import {
  classifyChatGpt,
  classifyProbe,
  DEFAULT_CHATGPT_SHARE_URL,
  evaluateRun,
  type PlatformResult,
  type StructureScope,
  type StructureSnapshot,
} from "./src/health";

const RESULTS_DIR = path.join(process.cwd(), "test-results");

function blankToUndefined(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function writeResult(result: PlatformResult) {
  fs.mkdirSync(RESULTS_DIR, { recursive: true });
  fs.writeFileSync(
    path.join(RESULTS_DIR, `${result.platform}-result.json`),
    JSON.stringify(result, null, 2),
  );
  console.log(
    `${result.platform}: status=${result.status} reachability=${result.reachability} verification=${result.verification}`,
  );
}

async function screenshot(page: Page, platform: string) {
  if (process.env.CHATGPT_STORAGE_STATE_PATH) return;
  try {
    await page.screenshot({
      path: path.join(RESULTS_DIR, `${platform}-failure.png`),
      fullPage: true,
    });
  } catch {
    console.warn(`Screenshot failed for ${platform}`);
  }
}

const HOMEPAGES: { name: string; id: string; url: string }[] = [
  { name: "Claude", id: "claude", url: "https://claude.ai" },
  { name: "Grok", id: "grok", url: "https://grok.com" },
  { name: "Gemini", id: "gemini", url: "https://gemini.google.com" },
  { name: "Perplexity", id: "perplexity", url: "https://www.perplexity.ai" },
  { name: "DeepSeek", id: "deepseek", url: "https://chat.deepseek.com" },
];

test.describe("Platform health checks", () => {
  test.describe.configure({ retries: process.env.CI ? 1 : 0 });

  test("ChatGPT - structure", async ({ browser }) => {
    const result = await checkChatGpt(browser);
    writeResult(result);
    expect(
      result.verification,
      result.error_message ?? "ChatGPT structure was not verified",
    ).toBe("verified");
  });

  for (const platform of HOMEPAGES) {
    test(`${platform.name} - reachability`, async ({ page }) => {
      const started = Date.now();
      const inspected = await inspectPage(page, platform.name, platform.url);
      const classified = classifyProbe(inspected.signals);
      const result: PlatformResult = {
        platform: platform.id,
        status: classified.status,
        reachability: classified.reachability,
        verification: classified.verification,
        content_verified: classified.content_verified,
        error_message: classified.error_message,
        error_category: classified.error_category,
        response_time_ms: Date.now() - started,
        diagnostics: inspected.diagnostics,
      };
      writeResult(result);

      if (
        classified.status === "failed" ||
        classified.status === "timeout" ||
        classified.status === "network_error" ||
        classified.status === "selector_not_found"
      ) {
        await screenshot(page, platform.id);
        throw new Error(
          `${platform.name} check failed [${classified.status}]: ${classified.error_message ?? ""}`,
        );
      }
    });
  }

  test.afterAll(() => {
    fs.mkdirSync(RESULTS_DIR, { recursive: true });
    const merged: PlatformResult[] = [];
    if (fs.existsSync(RESULTS_DIR)) {
      for (const file of fs.readdirSync(RESULTS_DIR)) {
        if (!file.endsWith("-result.json")) continue;
        try {
          merged.push(
            JSON.parse(fs.readFileSync(path.join(RESULTS_DIR, file), "utf8")) as PlatformResult,
          );
        } catch (error) {
          console.warn(`Could not read ${file}`, error);
        }
      }
    }
    fs.writeFileSync(
      path.join(RESULTS_DIR, "platform-results.json"),
      JSON.stringify(merged, null, 2),
    );
    const verdict = evaluateRun(merged);
    fs.writeFileSync(
      path.join(RESULTS_DIR, "verdict.json"),
      JSON.stringify(verdict, null, 2),
    );
    console.log(`Verdict ok=${verdict.ok}`);
    for (const reason of verdict.reasons) console.log(`reason: ${reason}`);
    for (const warning of verdict.warnings) console.log(`warning: ${warning}`);
  });
});

async function checkChatGpt(browser: Browser): Promise<PlatformResult> {
  const started = Date.now();
  const storagePath = blankToUndefined(process.env.CHATGPT_STORAGE_STATE_PATH);
  const conversationUrl = blankToUndefined(process.env.CHATGPT_CONVERSATION_URL);
  const shareUrl =
    blankToUndefined(process.env.CHATGPT_SHARE_URL) ||
    blankToUndefined(process.env.CHATGPT_SHARE_URL_VAR) ||
    DEFAULT_CHATGPT_SHARE_URL;
  const useLogin = Boolean(storagePath && conversationUrl);
  const scope: StructureScope = useLogin ? "logged_in" : "public_share";
  const structureUrl = useLogin ? conversationUrl! : shareUrl;

  const context = await browser.newContext(
    useLogin && storagePath ? { storageState: storagePath } : {},
  );
  const page = await context.newPage();

  try {
    const home = await inspectPage(page, "ChatGPT", "https://chatgpt.com");
    const homepage = classifyProbe(home.signals);

    let snapshot: StructureSnapshot | null = null;
    let structureBlocked = false;
    let structureDownMessage: string | null = null;
    let structureTimeout = false;
    let structureDiag = home.diagnostics;

    try {
      const response = await page.goto(structureUrl, {
        waitUntil: "domcontentloaded",
        timeout: 45000,
      });
      await page.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => {});
      await page
        .waitForSelector(
          'main [data-message-role="user"], main [data-conversation-role="user"], main [data-message-author-role="user"]',
          { timeout: 15000 },
        )
        .catch(() => {});
      structureDiag = await collectDiagnostics(page);
      const title = structureDiag.page_title;
      const blockedTitle =
        /just a moment|attention required|cloudflare|security check/i.test(title);
      const httpStatus = response ? response.status() : null;
      if (httpStatus !== null && httpStatus >= 500) {
        structureDownMessage = `HTTP ${httpStatus}`;
      } else if (blockedTitle || (await pageIndicatesBlock(page))) {
        structureBlocked = true;
      } else {
        snapshot = await page.evaluate(readStructureSnapshot);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      structureDownMessage = message.slice(0, 300);
      structureTimeout = /timeout|timed out/i.test(message);
    }

    const classified = classifyChatGpt({
      homepage,
      snapshot,
      structureBlocked,
      structureDownMessage,
      structureTimeout,
      scope,
      structureUrl,
    });

    if (classified.verification !== "verified") {
      await screenshot(page, "chatgpt");
    }

    const notes = [...classified.notes];
    if (!useLogin && (storagePath || conversationUrl)) {
      notes.push(
        "CHATGPT_STORAGE_STATE und CHATGPT_CONVERSATION_URL müssen zusammen gesetzt sein. Es wurde die öffentliche Share-Seite geprüft.",
      );
    }

    return {
      platform: "chatgpt",
      status: classified.status,
      reachability: classified.reachability,
      verification: classified.verification,
      content_verified: classified.content_verified,
      error_message: classified.error_message,
      error_category: classified.error_category,
      response_time_ms: Date.now() - started,
      notes,
      structure: classified.structure,
      diagnostics: {
        ...structureDiag,
        homepage_url: home.diagnostics.final_url,
        homepage_status: homepage.status,
        homepage_title: home.diagnostics.page_title,
      },
    };
  } finally {
    await context.close();
  }
}

async function pageIndicatesBlock(page: Page): Promise<boolean> {
  try {
    const body = await page.locator("body").innerText({ timeout: 3000 });
    return /performing security verification|verify you are human|request could not be satisfied|generated by cloudfront/i.test(
      body,
    );
  } catch {
    return false;
  }
}
