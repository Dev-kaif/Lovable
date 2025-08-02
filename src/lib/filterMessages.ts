import { BaseMessage, SystemMessage } from "@langchain/core/messages";

/**
 * Filters the message array to:
 * - Retain only one SystemMessage (latest or first)
 * - Preserve order (SystemMessage comes first)
 */

export const filterMessages = (messages: BaseMessage[]): BaseMessage[] => {
  const nonSystemMessages = messages.filter(
    (msg) => !(msg instanceof SystemMessage)
  );
  const firstSystem = messages.find((msg) => msg instanceof SystemMessage);
  return firstSystem ? [firstSystem, ...nonSystemMessages] : nonSystemMessages;
};

/**
 * Optional: You can also inject a fresh system message and
 * ensure only one is present in total.
 */
export function injectSingleSystemMessage({
  messages,
  systemContent,
}: {
  messages: BaseMessage[];
  systemContent: string;
}): BaseMessage[] {
  const filtered = messages.filter((m) => !(m instanceof SystemMessage));
  return [new SystemMessage(systemContent), ...filtered];
}

import { HumanMessage, ToolMessage } from "@langchain/core/messages";

/**
 * Filters out repetitive messages from the conversation history
 * Keeps the first occurrence and removes subsequent duplicates
 */
export function filterRepetitiveMessages(
  messages: BaseMessage[]
): BaseMessage[] {
  const seen = new Set<string>();
  const filtered: BaseMessage[] = [];

  for (const message of messages) {
    // Create a unique key based on message type and content
    const messageKey = `${message.constructor.name}:${message.content
      ?.toString()
      .toLowerCase()
      .trim()}`;

    // Always keep SystemMessages (they're usually important prompts)
    if (message instanceof SystemMessage) {
      filtered.push(message);
      continue;
    }

    // Always keep ToolMessages (they contain execution results)
    if (message instanceof ToolMessage) {
      filtered.push(message);
      continue;
    }

    // For HumanMessage and AIMessage, check for duplicates
    if (!seen.has(messageKey)) {
      seen.add(messageKey);
      filtered.push(message);
    }
  }

  return filtered;
}

/**
 * More advanced filter that detects repetitive patterns in recent messages
 * Useful for detecting when a user keeps asking the same thing
 */
export function filterRepetitiveRecentMessages(
  messages: BaseMessage[],
  windowSize: number = 5,
  threshold: number = 3
): BaseMessage[] {
  if (messages.length <= windowSize) {
    return messages;
  }

  // Get recent human messages to check for repetition
  const recentHumanMessages = messages
    .slice(-windowSize)
    .filter((msg) => msg instanceof HumanMessage)
    .map((msg) => msg.content?.toString().toLowerCase().trim());

  if (recentHumanMessages.length < threshold) {
    return messages;
  }

  // Check if the last message is repeated too many times
  const lastMessage = recentHumanMessages[recentHumanMessages.length - 1];
  const repetitionCount = recentHumanMessages.filter(
    (msg) => msg === lastMessage
  ).length;

  if (repetitionCount >= threshold) {
    // Remove the repetitive messages, keep only the first occurrence
    const result: BaseMessage[] = [];
    const seenContent = new Set<string>();

    for (const message of messages) {
      if (message instanceof HumanMessage) {
        const content = message.content?.toString().toLowerCase().trim();
        if (content === lastMessage) {
          if (!seenContent.has(content)) {
            seenContent.add(content);
            result.push(message);
          }
          // Skip subsequent duplicates
        } else {
          result.push(message);
        }
      } else {
        result.push(message);
      }
    }

    return result;
  }

  return messages;
}

/**
 * Combined filter that handles both general duplicates and recent repetitive patterns
 */
export function filterAllRepetitiveMessages(
  messages: BaseMessage[],
  recentWindowSize: number = 5,
  repetitionThreshold: number = 3
): BaseMessage[] {
  // First filter out general duplicates
  let filtered = filterRepetitiveMessages(messages);

  // Then check for recent repetitive patterns
  filtered = filterRepetitiveRecentMessages(
    filtered,
    recentWindowSize,
    repetitionThreshold
  );

  return filtered;
}

/**
 * Utility function to detect if there's a repetitive pattern in recent messages
 * Returns true if repetition is detected
 */
export function detectRepetitivePattern(
  messages: BaseMessage[],
  windowSize: number = 5,
  threshold: number = 3
): boolean {
  const recentUserMessages = messages
    .filter((msg) => msg instanceof HumanMessage)
    .slice(-windowSize)
    .map((msg) => msg.content?.toString().toLowerCase().trim());

  if (recentUserMessages.length < threshold) return false;

  const lastMessage = recentUserMessages[recentUserMessages.length - 1];
  const identicalCount = recentUserMessages.filter(
    (msg) => msg === lastMessage
  ).length;

  return identicalCount >= threshold;
}

// Example usage in your existing code:
/*
// In your functions.ts, you could use it like this:
const cleanedMessages = filterAllRepetitiveMessages(currentMessages);

const mergedState: GraphState = {
  ...existingState.values,
  step,
  sandbox,
  messages: [...cleanedMessages, new HumanMessage(userQuery)],
  mainTaskExecuted: false,
  hasWriteErrors: false,
};
*/
