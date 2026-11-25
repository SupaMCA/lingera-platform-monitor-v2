import type { StructureSnapshot } from "./health";

/**
 * Runs in the browser via `page.evaluate`. Counts the attributes Lingera
 * cares about. Only elements inside `main` count, because that is where
 * ChatGPT renders the transcript.
 */
export function readStructureSnapshot(): StructureSnapshot {
  const main = document.querySelector("main");
  const count = (selector: string) =>
    main ? main.querySelectorAll(selector).length : 0;

  return {
    hasMain: main !== null,
    transcript: main
      ? main.querySelector("[data-conversation-transcript]") !== null
      : false,
    messageRoleUser: count('[data-message-role="user"]'),
    messageRoleAssistant: count('[data-message-role="assistant"]'),
    conversationRoleUser: count('[data-conversation-role="user"]'),
    conversationRoleAssistant: count('[data-conversation-role="assistant"]'),
    legacyUser: count('[data-message-author-role="user"]'),
    legacyAssistant: count('[data-message-author-role="assistant"]'),
    turnKey: count("[data-turn-key]"),
  };
}
