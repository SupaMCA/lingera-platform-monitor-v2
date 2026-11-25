/**
 * Classification for the Lingera platform monitor.
 *
 * `ok` means the content contract was verified. A Cloudflare block, a login
 * wall, or a page that only shows the brand is reachable-or-blocked, never ok.
 *
 * ChatGPT is special: the job fails unless the conversation structure was
 * verified. Other platforms may be bot-blocked from GitHub runners; that is
 * reported honestly and does not by itself fail the run.
 */

export const PLATFORMS = [
  "chatgpt",
  "claude",
  "grok",
  "gemini",
  "perplexity",
  "deepseek",
] as const;

export type PlatformId = (typeof PLATFORMS)[number];

export type Status =
  | "ok"
  | "failed"
  | "timeout"
  | "login_wall"
  | "cloudflare"
  | "brand_detected"
  | "network_error"
  | "selector_not_found";

export type Reachability = "reachable" | "blocked" | "down" | "not_checked";
export type Verification = "verified" | "unverified" | "not_checked";
export type StructureScope = "public_share" | "logged_in";

/** Public share used when no owner-supplied URL is configured. */
export const DEFAULT_CHATGPT_SHARE_URL =
  "https://chatgpt.com/share/6a1a1e2e-17f8-83e8-8f2b-2c4c187db51b";

export interface StructureSnapshot {
  hasMain: boolean;
  transcript: boolean;
  messageRoleUser: number;
  messageRoleAssistant: number;
  conversationRoleUser: number;
  conversationRoleAssistant: number;
  legacyUser: number;
  legacyAssistant: number;
  turnKey: number;
}

export interface StructureReport {
  scope: StructureScope;
  url: string;
  verified: boolean;
  found: string[];
  missing: string[];
  counts: StructureSnapshot;
}

export interface PlatformResult {
  platform: string;
  status: Status;
  reachability: Reachability;
  verification: Verification;
  content_verified: boolean;
  error_message?: string;
  error_category?: string;
  response_time_ms: number;
  notes?: string[];
  structure?: StructureReport;
  diagnostics?: {
    final_url: string;
    page_title: string;
    body_snippet: string;
    homepage_url?: string;
    homepage_status?: string;
    homepage_title?: string;
  };
}

export interface ProbeSignals {
  httpStatus: number | null;
  navigationError: string | null;
  timeout: boolean;
  cloudflare: boolean;
  waf: boolean;
  loginWall: boolean;
  brand: boolean;
  chatFound: boolean;
}

export interface ClassifiedProbe {
  status: Status;
  reachability: Reachability;
  verification: Verification;
  content_verified: boolean;
  error_category: string;
  error_message?: string;
}

export interface Verdict {
  ok: boolean;
  reasons: string[];
  warnings: string[];
}

const HARD_FAIL = new Set<Status>([
  "failed",
  "timeout",
  "network_error",
  "selector_not_found",
]);

export function classifyProbe(signals: ProbeSignals): ClassifiedProbe {
  if (signals.timeout) {
    return blockedOut(
      "timeout",
      "down",
      "timeout",
      signals.navigationError ?? "Zeitüberschreitung",
    );
  }

  if (signals.navigationError) {
    return blockedOut(
      "network_error",
      "down",
      "network_error",
      signals.navigationError,
    );
  }

  if (signals.httpStatus !== null && signals.httpStatus >= 500) {
    return blockedOut(
      "failed",
      "down",
      "network_error",
      `HTTP ${signals.httpStatus}`,
    );
  }

  if (signals.cloudflare || signals.waf) {
    const kind = signals.waf ? "AWS WAF/CloudFront" : "Cloudflare";
    return {
      status: "cloudflare",
      reachability: "blocked",
      verification: "not_checked",
      content_verified: false,
      error_category: "cloudflare",
      error_message: `${kind} blockiert den Zugriff. Die Seite gilt nicht als ok.`,
    };
  }

  if (signals.chatFound) {
    return {
      status: "ok",
      reachability: "reachable",
      verification: "verified",
      content_verified: true,
      error_category: "ok",
    };
  }

  if (signals.loginWall) {
    return {
      status: "login_wall",
      reachability: "reachable",
      verification: "unverified",
      content_verified: false,
      error_category: "login_wall",
      error_message:
        "Login-Wand. Die Plattform antwortet, der Inhalt ist nicht verifiziert.",
    };
  }

  if (signals.brand) {
    return {
      status: "brand_detected",
      reachability: "reachable",
      verification: "unverified",
      content_verified: false,
      error_category: "brand_detected",
      error_message:
        "Marke sichtbar, aber keine Chat- oder Gesprächsstruktur. Nicht ok.",
    };
  }

  return {
    status: "selector_not_found",
    reachability: "reachable",
    verification: "unverified",
    content_verified: false,
    error_category: "selector_not_found",
    error_message: "Seite geladen, erwartete Struktur nicht gefunden.",
  };
}

function blockedOut(
  status: Status,
  reachability: Reachability,
  category: string,
  message: string,
): ClassifiedProbe {
  return {
    status,
    reachability,
    verification: "not_checked",
    content_verified: false,
    error_category: category,
    error_message: message,
  };
}

export function assessStructure(
  snapshot: StructureSnapshot,
  scope: StructureScope,
): { verified: boolean; found: string[]; missing: string[] } {
  const found = describeSnapshot(snapshot);
  const missing: string[] = [];

  if (scope === "logged_in") {
    if (!snapshot.hasMain) missing.push("main");
    if (snapshot.conversationRoleUser < 1) {
      missing.push('main [data-conversation-role="user"]');
    }
    if (snapshot.conversationRoleAssistant < 1) {
      missing.push('main [data-conversation-role="assistant"]');
    }
    if (snapshot.turnKey < 1) missing.push("main [data-turn-key]");
  } else {
    if (!snapshot.hasMain) missing.push("main");
    if (!snapshot.transcript) missing.push("main [data-conversation-transcript]");
    if (snapshot.messageRoleUser < 1) {
      missing.push('main [data-message-role="user"]');
    }
    if (snapshot.messageRoleAssistant < 1) {
      missing.push('main [data-message-role="assistant"]');
    }
  }

  return { verified: missing.length === 0, found, missing };
}

export function describeSnapshot(snapshot: StructureSnapshot): string[] {
  return [
    `main=${snapshot.hasMain}`,
    `transcript=${snapshot.transcript}`,
    `data-message-role user=${snapshot.messageRoleUser} assistant=${snapshot.messageRoleAssistant}`,
    `data-conversation-role user=${snapshot.conversationRoleUser} assistant=${snapshot.conversationRoleAssistant}`,
    `data-turn-key=${snapshot.turnKey}`,
    `data-message-author-role user=${snapshot.legacyUser} assistant=${snapshot.legacyAssistant}`,
  ];
}

export function classifyChatGpt(input: {
  homepage: ClassifiedProbe;
  snapshot: StructureSnapshot | null;
  structureBlocked: boolean;
  structureDownMessage: string | null;
  structureTimeout: boolean;
  scope: StructureScope;
  structureUrl: string;
}): {
  status: Status;
  reachability: Reachability;
  verification: Verification;
  content_verified: boolean;
  error_category: string;
  error_message?: string;
  notes: string[];
  structure: StructureReport;
} {
  const notes: string[] = [];
  if (input.homepage.reachability === "blocked") {
    notes.push(
      `Startseite blockiert (${input.homepage.status}). Die Struktur wird getrennt geprüft.`,
    );
  } else if (input.homepage.reachability === "down") {
    notes.push(
      `Startseite nicht erreichbar (${input.homepage.status}). Die Struktur wird getrennt geprüft.`,
    );
  }

  const surface =
    input.scope === "logged_in"
      ? "eingeloggte Unterhaltung"
      : "öffentliche Share-Seite";

  if (input.structureTimeout) {
    return unfinished(input, notes, "timeout", "down", "timeout", [
      `Strukturseite Zeitüberschreitung (${surface}): ${input.structureDownMessage ?? input.structureUrl}`,
    ]);
  }

  if (input.structureBlocked) {
    return unfinished(input, notes, "cloudflare", "blocked", "cloudflare", [
      `Strukturseite blockiert (${surface}, ${input.structureUrl}). ChatGPT ist nicht verifiziert.`,
    ]);
  }

  if (input.structureDownMessage || !input.snapshot) {
    return unfinished(
      input,
      notes,
      "network_error",
      "down",
      "network_error",
      [
        `Strukturseite nicht erreichbar (${surface}): ${input.structureDownMessage ?? "kein DOM"}`,
      ],
    );
  }

  const assessment = assessStructure(input.snapshot, input.scope);
  const structure: StructureReport = {
    scope: input.scope,
    url: input.structureUrl,
    verified: assessment.verified,
    found: assessment.found,
    missing: assessment.missing,
    counts: input.snapshot,
  };

  if (assessment.verified) {
    if (input.scope === "public_share") {
      notes.push(
        "Verifiziert auf einer öffentlichen Share-Seite (data-message-role in main). Die eingeloggte Oberfläche (data-conversation-role / data-turn-key) wird erst mit CHATGPT_STORAGE_STATE und CHATGPT_CONVERSATION_URL geprüft.",
      );
    }
    return {
      status: "ok",
      reachability: "reachable",
      verification: "verified",
      content_verified: true,
      error_category: "ok",
      notes,
      structure,
    };
  }

  const expected =
    input.scope === "logged_in"
      ? "data-conversation-role (user und assistant) und data-turn-key in main"
      : 'data-message-role="user|assistant" in main [data-conversation-transcript]';

  return {
    status: "selector_not_found",
    reachability: "reachable",
    verification: "unverified",
    content_verified: false,
    error_category: "selector_not_found",
    error_message: `ChatGPT-Struktur weicht ab (${surface}). Erwartet: ${expected}. Fehlend: ${assessment.missing.join(", ")}. Gefunden: ${assessment.found.join("; ")}.`,
    notes,
    structure,
  };
}

function unfinished(
  input: {
    scope: StructureScope;
    structureUrl: string;
    snapshot: StructureSnapshot | null;
  },
  notes: string[],
  status: Status,
  reachability: Reachability,
  category: string,
  messageParts: string[],
): {
  status: Status;
  reachability: Reachability;
  verification: Verification;
  content_verified: boolean;
  error_category: string;
  error_message: string;
  notes: string[];
  structure: StructureReport;
} {
  return {
    status,
    reachability,
    verification: "not_checked",
    content_verified: false,
    error_category: category,
    error_message: messageParts.join(" "),
    notes,
    structure: {
      scope: input.scope,
      url: input.structureUrl,
      verified: false,
      found: input.snapshot ? describeSnapshot(input.snapshot) : [],
      missing: ["structure page did not yield a DOM snapshot"],
      counts: input.snapshot ?? emptySnapshot(),
    },
  };
}

export function emptySnapshot(): StructureSnapshot {
  return {
    hasMain: false,
    transcript: false,
    messageRoleUser: 0,
    messageRoleAssistant: 0,
    conversationRoleUser: 0,
    conversationRoleAssistant: 0,
    legacyUser: 0,
    legacyAssistant: 0,
    turnKey: 0,
  };
}

export function evaluateRun(results: PlatformResult[]): Verdict {
  const reasons: string[] = [];
  const warnings: string[] = [];

  if (results.length === 0) {
    reasons.push("nicht geprüft / not checked: keine Plattform-Ergebnisse");
  }

  for (const platform of PLATFORMS) {
    const result = results.find((item) => item.platform === platform);
    if (!result) {
      reasons.push(`${platform}: nicht geprüft / not checked`);
      continue;
    }

    if (platform === "chatgpt" && result.verification !== "verified") {
      reasons.push(
        `chatgpt: Struktur nicht verifiziert (${result.status}). ${result.error_message ?? ""}`.trim(),
      );
      continue;
    }

    if (HARD_FAIL.has(result.status)) {
      reasons.push(
        `${platform}: ${result.status}. ${result.error_message ?? ""}`.trim(),
      );
      continue;
    }

    if (result.status !== "ok") {
      warnings.push(
        `${platform}: ${result.status} (Erreichbarkeit ${result.reachability}, Verifikation ${result.verification}) — zählt nicht als ok`,
      );
    }
  }

  return { ok: reasons.length === 0, reasons, warnings };
}
