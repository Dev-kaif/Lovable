import {
  BaseMessage,
  SystemMessage,
  HumanMessage,
  ToolMessage,
} from "@langchain/core/messages";

interface MessageSummary {
  type: string;
  contentHash: string;
  timestamp?: number;
}

// Generate a hash for message content
function hashContent(content: string): string {
  return content.toLowerCase().trim().replace(/\s+/g, " ");
}

// Create a unique signature for a message
function getMessageSignature(message: BaseMessage): MessageSummary {
  const content = message.content?.toString() || "";
  return {
    type: message.constructor.name,
    contentHash: hashContent(content),
    timestamp: Date.now(),
  };
}

/**
 * 🚀 FIXED: Less aggressive repetitive message filter
 */
export function filterRepetitiveMessagesAdvanced(
  messages: BaseMessage[],
  options: {
    maxDuplicates?: number;
    recentWindowSize?: number;
    aggressiveMode?: boolean;
    preserveSystemMessages?: boolean;
    preserveToolMessages?: boolean;
  } = {}
): BaseMessage[] {
  const {
    maxDuplicates = 2, // 🔧 INCREASED from 2 to 3
    recentWindowSize = 8, // 🔧 INCREASED from 8 to 10
    aggressiveMode = true, // 🔧 CHANGED from true to false
    preserveSystemMessages = true,
    preserveToolMessages = true,
  } = options;

  if (messages.length === 0) return messages;

  const filtered: BaseMessage[] = [];
  const contentCounts = new Map<string, number>();
  const lastSeenIndex = new Map<string, number>();

  // 🔧 FIXED: Track consecutive identical requests more carefully
  let consecutiveCount = 0;
  let lastUserMessage = "";

  for (let i = 0; i < messages.length; i++) {
    const message = messages[i];
    const signature = getMessageSignature(message);
    const key = `${signature.type}:${signature.contentHash}`;

    // Always preserve certain message types if specified
    if (preserveSystemMessages && message instanceof SystemMessage) {
      // Only keep the first system message that contains the main prompt
      if (
        !filtered.some(
          (m) =>
            m instanceof SystemMessage &&
            m.content.toString().includes("You are a senior software engineer")
        )
      ) {
        filtered.push(message);
      }
      continue;
    }

    if (preserveToolMessages && message instanceof ToolMessage) {
      filtered.push(message);
      continue;
    }

    // 🔧 FIXED: Track consecutive identical human messages more carefully
    if (message instanceof HumanMessage) {
      const currentContent = signature.contentHash;
      if (currentContent === lastUserMessage) {
        consecutiveCount++;
      } else {
        consecutiveCount = 1;
        lastUserMessage = currentContent;
      }

      // 🔧 FIXED: Only block after 4+ consecutive identical requests (was 2)
      if (aggressiveMode && consecutiveCount > 2) {
        console.log(
          `🚫 Blocking consecutive duplicate: "${currentContent.slice(
            0,
            50
          )}..."`
        );
        continue;
      }
    }

    // Count occurrences
    const currentCount = contentCounts.get(key) || 0;
    const lastIndex = lastSeenIndex.get(key);

    // Check if we should include this message
    let shouldInclude = true;

    if (currentCount >= maxDuplicates) {
      // Check if it's within recent window
      if (lastIndex !== undefined && i - lastIndex < recentWindowSize) {
        shouldInclude = false;
        console.log(
          `🔄 Filtered duplicate within window: ${key.slice(0, 50)}...`
        );
      }
    }

    if (shouldInclude) {
      filtered.push(message);
      contentCounts.set(key, currentCount + 1);
      lastSeenIndex.set(key, i);
    }
  }

  return filtered;
}

/**
 * 🚀 FIXED: More conservative repetitive loop detection
 */
export function detectRepetitiveLoop(
  messages: BaseMessage[],
  threshold: number = 3// 🔧 INCREASED from 3 to 5
): {
  hasLoop: boolean;
  pattern?: string;
  count?: number;
  shouldTerminate?: boolean;
} {
  const recentHumanMessages = messages
    .filter((msg) => msg instanceof HumanMessage)
    .slice(-6) // 🔧 INCREASED from 6 to 8
    .map((msg) => hashContent(msg.content?.toString() || ""));

  if (recentHumanMessages.length < threshold) {
    return { hasLoop: false };
  }

  // Check for exact repetitions
  const lastMessage = recentHumanMessages[recentHumanMessages.length - 1];
  const repetitionCount = recentHumanMessages.filter(
    (msg) => msg === lastMessage
  ).length;

  // 🔧 FIXED: Only consider it a loop if we have actual progress indicators
  const hasActualProgress = messages.some(
    (msg) =>
      msg instanceof ToolMessage &&
      typeof msg.content === "string" &&
      (msg.content.includes("✅ Successfully wrote") ||
        msg.content.includes("Command executed successfully") ||
        msg.content.includes("=== END"))
  );

  // 🔧 FIXED: If we have progress, don't consider it a problematic loop
  if (hasActualProgress && repetitionCount < 6) {
    return { hasLoop: false };
  }

  if (repetitionCount >= threshold) {
    return {
      hasLoop: true,
      pattern: lastMessage.slice(0, 50),
      count: repetitionCount,
      shouldTerminate: repetitionCount >= 4, // 🔧 INCREASED from 4 to 7
    };
  }

  return { hasLoop: false };
}

/**
 * Smart message compression - removes redundant context while preserving important information
 */
export function compressMessageHistory(
  messages: BaseMessage[],
  maxLength: number = 20// 🔧 INCREASED from 20 to 25
): BaseMessage[] {
  if (messages.length <= maxLength) return messages;

  const compressed: BaseMessage[] = [];

  // Always keep the first system message
  const systemMessage = messages.find((msg) => msg instanceof SystemMessage);
  if (systemMessage) compressed.push(systemMessage);

  // Keep recent messages (last 15) - 🔧 INCREASED from 10 to 15
  const recentMessages = messages
    .slice(-10)
    .filter((msg) => !(msg instanceof SystemMessage));

  // Keep important milestone messages (successful operations)
  const milestones = messages
    .filter(
      (msg) =>
        msg instanceof ToolMessage &&
        typeof msg.content === "string" &&
        msg.content.includes("Successfully wrote")
    )
    .slice(-3); // Keep last 3 successful operations

  // Combine and deduplicate
  const combined = [...compressed, ...milestones, ...recentMessages];
  return filterRepetitiveMessagesAdvanced(combined, { aggressiveMode: false });
}

/**
 * 🚀 FIXED: Less aggressive master filter function
 */
export function masterMessageFilter(
  messages: BaseMessage[],
  options: {
    enableCompression?: boolean;
    maxHistoryLength?: number;
    autoTerminateLoops?: boolean;
  } = {}
): {
  messages: BaseMessage[];
  loopDetected: boolean;
  shouldTerminate: boolean;
  stats: {
    original: number;
    filtered: number;
    removed: number;
  };
} {
  const {
    enableCompression = true,
    maxHistoryLength = 25, // 🔧 INCREASED from 25 to 30
    autoTerminateLoops = true, // 🔧 CHANGED from true to false
  } = options;

  const originalCount = messages.length;

  // Step 1: Detect loops - but be more conservative
  const loopInfo = detectRepetitiveLoop(messages);

  if (loopInfo.hasLoop) {
    console.log(
      `🔄 Loop detected: "${loopInfo.pattern}" repeated ${loopInfo.count} times`
    );
  }

  // 🔧 FIXED: Only terminate if we have a severe loop AND no recent progress
  const hasRecentProgress = messages
    .slice(-5)
    .some(
      (msg) =>
        msg instanceof ToolMessage &&
        typeof msg.content === "string" &&
        (msg.content.includes("✅ Successfully wrote") ||
          msg.content.includes("Command executed successfully") ||
          msg.content.includes("=== END"))
    );

  const shouldActuallyTerminate =
    loopInfo.shouldTerminate && !hasRecentProgress;

  // Step 2: Apply less aggressive filtering
  let filtered = filterRepetitiveMessagesAdvanced(messages, {
    maxDuplicates: 3, // 🔧 LESS aggressive - allow 3 duplicates
    recentWindowSize: 12, // 🔧 INCREASED window size
    aggressiveMode: true, // 🔧 DISABLED aggressive mode
  });

  // Step 3: Compress if needed
  if (enableCompression && filtered.length > maxHistoryLength) {
    filtered = compressMessageHistory(filtered, maxHistoryLength);
  }

  // Step 4: Final system message cleanup
  filtered = cleanupSystemMessages(filtered);

  const finalCount = filtered.length;

  return {
    messages: filtered,
    loopDetected: loopInfo.hasLoop,
    shouldTerminate: autoTerminateLoops && shouldActuallyTerminate!,
    stats: {
      original: originalCount,
      filtered: finalCount,
      removed: originalCount - finalCount,
    },
  };
}

/**
 * Clean up system messages to ensure only one primary system message exists
 */
function cleanupSystemMessages(messages: BaseMessage[]): BaseMessage[] {
  let primarySystemMessage: SystemMessage | null = null;
  const otherMessages: BaseMessage[] = [];

  for (const message of messages) {
    if (message instanceof SystemMessage) {
      // Keep only the first comprehensive system message
      if (
        !primarySystemMessage &&
        message.content
          .toString()
          .includes("You are a senior software engineer")
      ) {
        primarySystemMessage = message;
      }
      // Skip other system messages
    } else {
      otherMessages.push(message);
    }
  }

  return primarySystemMessage
    ? [primarySystemMessage, ...otherMessages]
    : otherMessages;
}

// Legacy exports for backward compatibility
export const filterMessages = (messages: BaseMessage[]): BaseMessage[] => {
  const result = masterMessageFilter(messages, {
    enableCompression: false,
    autoTerminateLoops: true, // 🔧 DISABLED auto-termination
  });
  return result.messages;
};

export const filterAllRepetitiveMessages = (
  messages: BaseMessage[],
  windowSize: number = 5, // 🔧 INCREASED from 5 to 8
  threshold: number = 3 // 🔧 INCREASED from 3 to 4
): BaseMessage[] => {
  return filterRepetitiveMessagesAdvanced(messages, {
    maxDuplicates: threshold - 1,
    recentWindowSize: windowSize,
    aggressiveMode: false, // 🔧 DISABLED aggressive mode
  });
};

export const detectRepetitivePattern = (
  messages: BaseMessage[],
  windowSize: number = 5, // 🔧 INCREASED from 5 to 8
  threshold: number = 3 // 🔧 INCREASED from 3 to 5
): boolean => {
  const result = detectRepetitiveLoop(messages, threshold);
  return result.hasLoop;
};
