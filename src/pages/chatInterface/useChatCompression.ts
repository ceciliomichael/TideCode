import { useCallback } from "react";
import type { ChatMode, Message } from "../../types/chat";
import type { ChatRuntimeSelection } from "../../hooks/chatMessageRuntime";
import { toUserFacingErrorMessage } from "../../lib/userFacingError";

interface CompressionSelection {
  hasConfiguredProvider: boolean;
  modelId: string;
  providerId: ChatRuntimeSelection["providerId"];
  reasoningEffort: ChatRuntimeSelection["reasoningEffort"];
}

interface UseChatCompressionInput {
  activeConversationId: string | null;
  activeWorkspacePath: string | null;
  chatMode: ChatMode;
  clearQueuedMessages: () => void;
  compressionSelection: CompressionSelection;
  isBusy: boolean;
  messages: Message[];
  isCompressingChat: boolean;
  onCompactionComplete: () => void;
  runtimeSelection: ChatRuntimeSelection;
  setError: (errorMessage: string | null) => void;
  setIsCompressingChat: (nextValue: boolean) => void;
}

export function useChatCompression(input: UseChatCompressionInput) {
  const {
    activeWorkspacePath,
    activeConversationId,
    chatMode,
    clearQueuedMessages,
    compressionSelection,
    isBusy,
    isCompressingChat,
    messages,
    runtimeSelection,
    onCompactionComplete,
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
      const result = await window.echosphereChat.compactConversation({
        agentContextRootPath: activeWorkspacePath,
        chatMode,
        conversationId: activeConversationId,
        contextCompaction: runtimeSelection.contextCompaction,
        messages,
        modelId: compressionSelection.modelId,
        providerId: compressionSelection.providerId,
        reasoningEffort: compressionSelection.reasoningEffort,
        targetModelId: runtimeSelection.modelId,
        targetProviderId: runtimeSelection.providerId ?? undefined,
        terminalExecutionMode: runtimeSelection.terminalExecutionMode,
      });
      if (!result.compacted) {
        setError("There is not yet a safe completed turn to compact.");
      } else {
        onCompactionComplete();
      }
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
    chatMode,
    clearQueuedMessages,
    compressionSelection,
    isBusy,
    isCompressingChat,
    messages,
    onCompactionComplete,
    runtimeSelection,
    setError,
    setIsCompressingChat,
  ]);

  return {
    handleCompressChat,
  };
}
