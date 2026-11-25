import { test, expect } from "@playwright/test";
import {
  assessStructure,
  classifyChatGpt,
  classifyProbe,
  emptySnapshot,
  evaluateRun,
  type PlatformResult,
  type ProbeSignals,
  type StructureSnapshot,
} from "./src/health";
import { readStructureSnapshot } from "./src/dom-snapshot";

function signals(overrides: Partial<ProbeSignals> = {}): ProbeSignals {
  return {
    httpStatus: 200,
    navigationError: null,
    timeout: false,
    cloudflare: false,
    waf: false,
    loginWall: false,
    brand: false,
    chatFound: false,
    ...overrides,
  };
}

function result(
  platform: string,
  overrides: Partial<PlatformResult> = {},
): PlatformResult {
  return {
    platform,
    status: "ok",
    reachability: "reachable",
    verification: "verified",
    content_verified: true,
    response_time_ms: 10,
    ...overrides,
  };
}

const shareSnapshot: StructureSnapshot = {
  hasMain: true,
  transcript: true,
  messageRoleUser: 5,
  messageRoleAssistant: 5,
  conversationRoleUser: 0,
  conversationRoleAssistant: 0,
  legacyUser: 0,
  legacyAssistant: 0,
  turnKey: 0,
};

const loggedInSnapshot: StructureSnapshot = {
  hasMain: true,
  transcript: false,
  messageRoleUser: 0,
  messageRoleAssistant: 0,
  conversationRoleUser: 2,
  conversationRoleAssistant: 2,
  legacyUser: 0,
  legacyAssistant: 0,
  turnKey: 4,
};

test("cloudflare, login wall, and brand are not ok", () => {
  for (const probe of [
    classifyProbe(signals({ cloudflare: true, httpStatus: 403, brand: true })),
    classifyProbe(signals({ waf: true, httpStatus: 403 })),
    classifyProbe(signals({ loginWall: true, brand: true })),
    classifyProbe(signals({ brand: true })),
  ]) {
    expect(probe.status).not.toBe("ok");
    expect(probe.content_verified).toBe(false);
    expect(probe.verification).not.toBe("verified");
  }

  expect(classifyProbe(signals({ cloudflare: true })).reachability).toBe("blocked");
  expect(classifyProbe(signals({ loginWall: true })).status).toBe("login_wall");
  expect(classifyProbe(signals({ brand: true })).status).toBe("brand_detected");
});

test("a visible composer is verified ok", () => {
  const probe = classifyProbe(signals({ chatFound: true, loginWall: true, brand: true }));
  expect(probe).toMatchObject({
    status: "ok",
    reachability: "reachable",
    verification: "verified",
    content_verified: true,
  });
});

test("server errors and timeouts are down, not ok", () => {
  expect(classifyProbe(signals({ httpStatus: 503 })).status).toBe("failed");
  expect(classifyProbe(signals({ httpStatus: 503 })).reachability).toBe("down");
  const timedOut = classifyProbe(
    signals({ timeout: true, navigationError: "Timeout 30000ms exceeded", httpStatus: null }),
  );
  expect(timedOut.status).toBe("timeout");
  expect(timedOut.verification).toBe("not_checked");
});

test("public share contract matches data-message-role inside main", () => {
  const share = assessStructure(shareSnapshot, "public_share");
  expect(share.verified).toBe(true);
  expect(share.missing).toEqual([]);

  const legacyOnly = assessStructure(
    {
      ...emptySnapshot(),
      hasMain: true,
      legacyUser: 2,
      legacyAssistant: 2,
    },
    "public_share",
  );
  expect(legacyOnly.verified).toBe(false);
  expect(legacyOnly.missing.join(" ")).toContain("data-message-role");
});

test("logged-in contract is data-conversation-role and data-turn-key", () => {
  expect(assessStructure(loggedInSnapshot, "logged_in").verified).toBe(true);
  expect(assessStructure(shareSnapshot, "logged_in").verified).toBe(false);
  expect(assessStructure(loggedInSnapshot, "public_share").verified).toBe(false);

  const legacy = assessStructure(
    { ...emptySnapshot(), hasMain: true, legacyUser: 1, legacyAssistant: 1 },
    "logged_in",
  );
  expect(legacy.verified).toBe(false);
  expect(legacy.missing.join(" ")).toContain("data-conversation-role");
  expect(legacy.missing.join(" ")).toContain("data-turn-key");
});

test("verified share structure is ok even when the homepage was blocked", () => {
  const classified = classifyChatGpt({
    homepage: classifyProbe(signals({ cloudflare: true, httpStatus: 403 })),
    snapshot: shareSnapshot,
    structureBlocked: false,
    structureDownMessage: null,
    structureTimeout: false,
    scope: "public_share",
    structureUrl: "https://chatgpt.com/share/example",
  });
  expect(classified.status).toBe("ok");
  expect(classified.content_verified).toBe(true);
  expect(classified.notes.join(" ")).toContain("Startseite blockiert");
  expect(classified.structure.verified).toBe(true);
});

test("a loaded share page with the wrong attributes fails closed", () => {
  const classified = classifyChatGpt({
    homepage: classifyProbe(signals({ brand: true })),
    snapshot: { ...emptySnapshot(), hasMain: true, legacyUser: 1, legacyAssistant: 1 },
    structureBlocked: false,
    structureDownMessage: null,
    structureTimeout: false,
    scope: "public_share",
    structureUrl: "https://chatgpt.com/share/example",
  });
  expect(classified.status).toBe("selector_not_found");
  expect(classified.verification).toBe("unverified");
  expect(classified.content_verified).toBe(false);
  expect(classified.error_message).toContain("data-message-author-role");
});

test("blocked structure page does not count as checked", () => {
  const classified = classifyChatGpt({
    homepage: classifyProbe(signals({ cloudflare: true, httpStatus: 403 })),
    snapshot: null,
    structureBlocked: true,
    structureDownMessage: null,
    structureTimeout: false,
    scope: "public_share",
    structureUrl: "https://chatgpt.com/share/example",
  });
  expect(classified.verification).toBe("not_checked");
  expect(classified.status).toBe("cloudflare");
  expect(classified.content_verified).toBe(false);
});

test("run verdict: ChatGPT must be verified, other blocks are warnings", () => {
  const healthy = evaluateRun([
    result("chatgpt"),
    result("claude", {
      status: "cloudflare",
      reachability: "blocked",
      verification: "not_checked",
      content_verified: false,
    }),
    result("grok"),
    result("gemini"),
    result("perplexity", {
      status: "login_wall",
      reachability: "reachable",
      verification: "unverified",
      content_verified: false,
    }),
    result("deepseek", {
      status: "cloudflare",
      reachability: "blocked",
      verification: "not_checked",
      content_verified: false,
    }),
  ]);
  expect(healthy.ok).toBe(true);
  expect(healthy.warnings.map((line) => line.split(":")[0]).sort()).toEqual([
    "claude",
    "deepseek",
    "perplexity",
  ]);

  const missed = evaluateRun([]);
  expect(missed.ok).toBe(false);
  expect(missed.reasons.join("\n")).toContain("nicht geprüft / not checked");

  const structureDrift = evaluateRun([
    result("chatgpt", {
      status: "selector_not_found",
      verification: "unverified",
      content_verified: false,
      error_message: "Attribut fehlt",
    }),
    result("claude"),
    result("grok"),
    result("gemini"),
    result("perplexity"),
    result("deepseek"),
  ]);
  expect(structureDrift.ok).toBe(false);
  expect(structureDrift.reasons[0]).toContain("chatgpt");
});

test("DOM scraper reads the public and the logged-in contracts", async ({ page }) => {
  await page.setContent(`
    <main>
      <ol data-conversation-transcript>
        <li data-message-role="user">Frage</li>
        <li data-message-role="assistant">Antwort</li>
      </ol>
    </main>
  `);
  const share = await page.evaluate(readStructureSnapshot);
  expect(assessStructure(share, "public_share").verified).toBe(true);
  expect(assessStructure(share, "logged_in").verified).toBe(false);

  await page.setContent(`
    <main>
      <article data-turn-key="t1" data-conversation-role="user">Frage</article>
      <article data-turn-key="t2" data-conversation-role="assistant">Antwort</article>
    </main>
  `);
  const loggedIn = await page.evaluate(readStructureSnapshot);
  expect(assessStructure(loggedIn, "logged_in").verified).toBe(true);

  await page.setContent(`
    <main>
      <div data-message-author-role="user">alt</div>
      <div data-message-author-role="assistant">alt</div>
    </main>
  `);
  const legacy = await page.evaluate(readStructureSnapshot);
  expect(assessStructure(legacy, "public_share").verified).toBe(false);
  expect(assessStructure(legacy, "logged_in").verified).toBe(false);
  expect(legacy.legacyUser).toBe(1);
});
