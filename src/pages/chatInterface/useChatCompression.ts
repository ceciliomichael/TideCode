import { useCallback } from "react";
import { v4 as uuidv4 } from "uuid";
import type { ChatMode, Message } from "../../types/chat";
import type { ChatRuntimeSelection } from "../../hooks/chatMessageRuntime";
import { toUserFacingErrorMessage } from "../../lib/userFacingError";
import {
  buildCompressedHistoryAcknowledgementMessage,
  buildCompressedHistoryMessage,
} from "../../lib/chatCompression";

interface CompressionSelection {
  hasConfiguredProvider: boolean;
  modelId: string;
  providerId: ChatRuntimeSelection["providerId"];
  reasoningEffort: ChatRuntimeSelection["reasoningEffort"];
}

interface UseChatCompressionInput {
  activeConversationId: string | null;
  activeConversationTitle: string;
  activeWorkspacePath: string | null;
  chatMode: ChatMode;
  clearQueuedMessages: () => void;
  compressionSelection: CompressionSelection;
  isBusy: boolean;
  messages: Message[];
  isCompressingChat: boolean;
  runtimeSelection: ChatRuntimeSelection;
  sendProgrammaticMessage: (
    runtimeSelection: ChatRuntimeSelection,
    messageText: string,
    options?: {
      chatMode?: ChatMode
      compactionSourceConversationId?: string
      forceNewConversation?: boolean
      syntheticAssistantMessage?: Message
      title?: string
    },
  ) => Promise<void>;
  setError: (errorMessage: string | null) => void;
  setIsCompressingChat: (nextValue: boolean) => void;
}

function buildCompressionSeedMessage(summary: string) {
  return buildCompressedHistoryMessage(summary);
}

function buildCompressionAcknowledgementMessage() {
  return buildCompressedHistoryAcknowledgementMessage(uuidv4());
}

export function useChatCompression(input: UseChatCompressionInput) {
  const {
    activeWorkspacePath,
    activeConversationId,
    activeConversationTitle,
    chatMode,
    clearQueuedMessages,
    compressionSelection,
    isBusy,
    isCompressingChat,
    messages,
    runtimeSelection,
    sendProgrammaticMessage,
    setError,
    setIsCompressingChat,
  } = input;

  const handleCompressChat = useCallback(async () => {
    if (isCompressingChat) {
      return;
    }

    if (messages.length === 0) {
      setError("Send at least one message before compressing the chat.");
      return;
    }

    if (!activeConversationId) {
      setError("Open a saved chat before compressing it.");
      return;
    }

    if (isBusy) {
      setError(
        "Wait for the current response to finish before compressing this chat.",
      );
      return;
    }

    if (!activeWorkspacePath) {
      setError("Open a chat with workspace context before compressing it.");
      return;
    }

    if (!compressionSelection.hasConfiguredProvider || !compressionSelection.providerId) {
      setError("Configure a provider before compressing this chat.");
      return;
    }

    if (compressionSelection.modelId.trim().length === 0) {
      setError("Select a model before compressing this chat.");
      return;
    }

    setIsCompressingChat(true);
    setError(null);
    clearQueuedMessages();

    try {
      const summary = await window.echosphereChat.compressConversation({
        agentContextRootPath: activeWorkspacePath,
        chatMode,
        messages,
        modelId: compressionSelection.modelId,
        providerId: compressionSelection.providerId,
        reasoningEffort: compressionSelection.reasoningEffort,
      });

      await sendProgrammaticMessage(
        runtimeSelection,
        buildCompressionSeedMessage(summary),
        {
          chatMode,
          compactionSourceConversationId: activeConversationId,
          forceNewConversation: true,
          syntheticAssistantMessage: buildCompressionAcknowledgementMessage(),
          title: activeConversationTitle,
        },
      );
    } catch (caughtError) {
      console.error("Failed to compress chat history", caughtError);
      setError(
        toUserFacingErrorMessage(caughtError, "Unable to compress the current chat."),
      );
    } finally {
      setIsCompressingChat(false);
    }
  }, [
    activeWorkspacePath,
    activeConversationId,
    activeConversationTitle,
    chatMode,
    clearQueuedMessages,
    compressionSelection,
    isBusy,
    isCompressingChat,
    messages,
    runtimeSelection,
    sendProgrammaticMessage,
    setError,
    setIsCompressingChat,
  ]);

  return {
    handleCompressChat,
  };
}
