import { isVisibleTranscriptMessage } from "../../lib/chatMessageMetadata";
import type { Message } from "../../types/chat";

export type TranscriptRenderEntry =
  | {
      kind: "assistant";
      messages: readonly Message[];
    }
  | {
      kind: "user";
      message: Message;
    };

export function groupVisibleTranscriptMessages(messages: readonly Message[]) {
  const entries: TranscriptRenderEntry[] = [];
  let currentAssistantMessages: Message[] = [];

  const flushAssistantMessages = () => {
    if (currentAssistantMessages.length === 0) {
      return;
    }

    entries.push({
      kind: "assistant",
      messages: currentAssistantMessages,
    });
    currentAssistantMessages = [];
  };

  for (const message of messages) {
    if (!isVisibleTranscriptMessage(message)) {
      continue;
    }

    if (message.role === "assistant") {
      currentAssistantMessages.push(message);
      continue;
    }

    flushAssistantMessages();
    entries.push({
      kind: "user",
      message,
    });
  }

  flushAssistantMessages();

  return entries;
}
