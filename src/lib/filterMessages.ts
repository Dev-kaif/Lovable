import {
  BaseMessage,
  SystemMessage,
  HumanMessage,
  ToolMessage,
  AIMessage,
} from "@langchain/core/messages";

interface MessageSummary {
  type: string;
  contentHash: string;
  toolName?: string;
  toolCallId?: string;
  timestamp?: number;
}

interface ToolMessageAnalysis {
  toolName: string;
  contentHash: string;
  isSuccess: boolean;
  isError: boolean;
  isCompletion: boolean;
  filePaths?: string[];
}

// Generate a normalized hash for message content
function hashContent(content: string): string {
  return content
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ")
    .replace(/✅|❌|🔧|📖|⚠️/g, "") // Remove emojis
    .replace(/\d{4,}/g, "TIMESTAMP") // Normalize timestamps
    .replace(/\b\d+\.\d+s?\b/g, "DURATION"); // Normalize durations
}

// Enhanced tool message analysis
function analyzeToolMessage(message: ToolMessage): ToolMessageAnalysis {
  const content = message.content?.toString() || "";
  const toolName = message.name || "unknown";

  // Extract file paths from content
  const filePaths: string[] = [];
  const filePathMatches = content.match(
    /(['"`])([^'"`]+\.(tsx?|jsx?|json|css|md))(['"`])/g
  );
  if (filePathMatches) {
    filePaths.push(
      ...filePathMatches.map((match) => match.replace(/['"`]/g, "").trim())
    );
  }

  // Also check for paths without quotes
  const pathPatterns = [
    /(?:app|lib|components)\/[^\s,]+\.(tsx?|jsx?|json|css|md)/g,
    /\/home\/user\/[^\s,]+\.(tsx?|jsx?|json|css|md)/g,
  ];

  pathPatterns.forEach((pattern) => {
    const matches = content.match(pattern);
    if (matches) {
      filePaths.push(...matches);
    }
  });

  return {
    toolName,
    contentHash: hashContent(content),
    isSuccess: content.includes("✅") || content.includes("Successfully"),
    isError:
      content.includes("❌") ||
      content.includes("Error") ||
      content.includes("Failed"),
    isCompletion:
      content.includes("Task completed") ||
      content.includes("already exist with identical content") ||
      content.includes("essentially complete") ||
      content.includes("TASK COMPLETION DETECTED"),
    filePaths: [...new Set(filePaths)], // Remove duplicates
  };
}

// Create a unique signature for a message
function getMessageSignature(message: BaseMessage): MessageSummary {
  const content = message.content?.toString() || "";
  const signature: MessageSummary = {
    type: message.constructor.name,
    contentHash: hashContent(content),
    timestamp: Date.now(),
  };

  if (message instanceof ToolMessage) {
    signature.toolName = message.name;
    signature.toolCallId = message.tool_call_id;
  }

  return signature;
}

/**
 * Enhanced tool message deduplication
 */
function filterToolMessages(messages: BaseMessage[]): BaseMessage[] {
  const toolMessageTracker = new Map<
    string,
    {
      lastSeen: number;
      analysis: ToolMessageAnalysis;
      message: ToolMessage;
    }
  >();

  const fileOperationTracker = new Map<
    string,
    {
      lastSuccessfulWrite: number;
      lastRead: number;
      contentHash: string;
    }
  >();

  const filtered: BaseMessage[] = [];

  for (let i = 0; i < messages.length; i++) {
    const message = messages[i];

    if (!(message instanceof ToolMessage)) {
      filtered.push(message);
      continue;
    }

    const analysis = analyzeToolMessage(message);
    const toolKey = `${analysis.toolName}:${analysis.contentHash}`;

    // Check for exact duplicate tool messages
    const existing = toolMessageTracker.get(toolKey);
    if (existing) {
      const timeDiff = i - existing.lastSeen;

      // Skip if we've seen this exact tool response recently
      if (timeDiff < 5) {
        console.log(
          `🚫 Filtered duplicate tool message: ${
            analysis.toolName
          } - "${analysis.contentHash.slice(0, 50)}..."`
        );
        continue;
      }
    }

    // Enhanced file operation tracking
    let shouldSkip = false;
    for (const filePath of analysis.filePaths!) {
      const fileKey = filePath.toLowerCase();
      const fileOp = fileOperationTracker.get(fileKey) || {
        lastSuccessfulWrite: 0,
        lastRead: 0,
        contentHash: "",
      };

      if (analysis.toolName === "createOrUpdateFiles") {
        if (analysis.isSuccess && fileOp.lastSuccessfulWrite > 0) {
          const recentWrite = i - fileOp.lastSuccessfulWrite < 8;
          if (recentWrite) {
            console.log(`🚫 Filtered redundant file write: ${filePath}`);
            shouldSkip = true;
            break;
          }
        }

        if (analysis.isSuccess) {
          fileOperationTracker.set(fileKey, {
            lastSuccessfulWrite: i,
            lastRead: fileOp.lastRead,
            contentHash: analysis.contentHash,
          });
        }
      }

      if (analysis.toolName === "readFiles") {
        if (fileOp.lastRead > 0) {
          const recentRead = i - fileOp.lastRead < 10;
          const sameContent = fileOp.contentHash === analysis.contentHash;

          if (recentRead && sameContent) {
            console.log(`🚫 Filtered redundant file read: ${filePath}`);
            shouldSkip = true;
            break;
          }
        }

        fileOperationTracker.set(fileKey, {
          lastSuccessfulWrite: fileOp.lastSuccessfulWrite,
          lastRead: i,
          contentHash: analysis.contentHash,
        });
      }
    }

    if (shouldSkip) continue;

    // Filter redundant completion messages
    if (analysis.isCompletion) {
      const recentCompletions = Array.from(toolMessageTracker.values()).filter(
        (t) => t.analysis.isCompletion && i - t.lastSeen < 5
      );

      if (recentCompletions.length > 0) {
        console.log(`🚫 Filtered redundant completion message`);
        continue;
      }
    }

    // Filter redundant error messages
    if (analysis.isError) {
      const sameErrors = Array.from(toolMessageTracker.values()).filter(
        (t) =>
          t.analysis.isError &&
          t.analysis.toolName === analysis.toolName &&
          t.analysis.contentHash === analysis.contentHash &&
          i - t.lastSeen < 3
      );

      if (sameErrors.length > 0) {
        console.log(
          `🚫 Filtered redundant error message: ${analysis.toolName}`
        );
        continue;
      }
    }

    // Update tracker and include message
    toolMessageTracker.set(toolKey, {
      lastSeen: i,
      analysis,
      message: message as ToolMessage,
    });

    filtered.push(message);
  }

  return filtered;
}

/**
 * Enhanced repetitive message filter with aggressive tool message filtering
 */
export function filterRepetitiveMessagesAdvanced(
  messages: BaseMessage[],
  options: {
    maxDuplicates?: number;
    recentWindowSize?: number;
    aggressiveMode?: boolean;
    preserveSystemMessages?: boolean;
    preserveToolMessages?: boolean;
    aggressiveToolFiltering?: boolean;
  } = {}
): BaseMessage[] {
  const {
    maxDuplicates = 2,
    recentWindowSize = 8,
    aggressiveMode = true,
    preserveSystemMessages = true,
    preserveToolMessages = false, // Changed default to false for aggressive filtering
    aggressiveToolFiltering = true, // New option
  } = options;

  if (messages.length === 0) return messages;

  // First pass: Filter tool messages if aggressive filtering is enabled
  let workingMessages = messages;
  if (aggressiveToolFiltering) {
    workingMessages = filterToolMessages(messages);
    console.log(
      `🔧 Tool filtering removed ${
        messages.length - workingMessages.length
      } redundant tool messages`
    );
  }

  const filtered: BaseMessage[] = [];
  const contentCounts = new Map<string, number>();
  const lastSeenIndex = new Map<string, number>();

  // Track consecutive patterns
  let consecutiveCount = 0;
  let lastUserMessage = "";
  let lastToolName = "";
  let consecutiveToolCount = 0;

  for (let i = 0; i < workingMessages.length; i++) {
    const message = workingMessages[i];
    const signature = getMessageSignature(message);
    const key = `${signature.type}:${signature.contentHash}`;

    // Always preserve certain message types if specified
    if (preserveSystemMessages && message instanceof SystemMessage) {
      // Only keep the first comprehensive system message
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

    // Enhanced tool message filtering
    if (message instanceof ToolMessage) {
      if (!preserveToolMessages) {
        const analysis = analyzeToolMessage(message);

        // Skip if we have too many consecutive tool messages of the same type
        if (analysis.toolName === lastToolName) {
          consecutiveToolCount++;
        } else {
          consecutiveToolCount = 1;
          lastToolName = analysis.toolName;
        }

        // Block excessive consecutive tool calls
        if (consecutiveToolCount > 3 && !analysis.isCompletion) {
          console.log(
            `🚫 Blocking excessive consecutive ${analysis.toolName} calls`
          );
          continue;
        }

        // Always preserve completion messages
        if (analysis.isCompletion) {
          filtered.push(message);
          continue;
        }

        // Filter redundant success messages for the same file operations
        if (analysis.isSuccess && analysis.filePaths!.length > 0) {
          const recentSimilar = filtered
            .slice(-5)
            .filter((m) => m instanceof ToolMessage)
            .some((m) => {
              const prevAnalysis = analyzeToolMessage(m as ToolMessage);
              return (
                prevAnalysis.toolName === analysis.toolName &&
                prevAnalysis.isSuccess &&
                prevAnalysis.filePaths!.some((path) =>
                  analysis.filePaths!.includes(path)
                )
              );
            });

          if (recentSimilar) {
            console.log(
              `🚫 Filtered redundant success message for ${analysis.toolName}`
            );
            continue;
          }
        }
      }
    }

    // Track consecutive identical human messages
    if (message instanceof HumanMessage) {
      const currentContent = signature.contentHash;
      if (currentContent === lastUserMessage) {
        consecutiveCount++;
      } else {
        consecutiveCount = 1;
        lastUserMessage = currentContent;
      }

      // Block excessive consecutive identical requests
      if (aggressiveMode && consecutiveCount > 3) {
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
 * Enhanced loop detection with tool message awareness
 */
export function detectRepetitiveLoop(
  messages: BaseMessage[],
  threshold: number = 3
): {
  hasLoop: boolean;
  pattern?: string;
  count?: number;
  shouldTerminate?: boolean;
  toolLoop?: boolean;
} {
  // Check for human message loops
  const recentHumanMessages = messages
    .filter((msg) => msg instanceof HumanMessage)
    .slice(-6)
    .map((msg) => hashContent(msg.content?.toString() || ""));

  const humanLoop = checkMessageLoop(recentHumanMessages, threshold);

  // Check for tool message loops
  const recentToolMessages = messages
    .filter((msg) => msg instanceof ToolMessage)
    .slice(-10)
    .map((msg) => {
      const analysis = analyzeToolMessage(msg as ToolMessage);
      return `${analysis.toolName}:${analysis.contentHash}`;
    });

  const toolLoop = checkMessageLoop(recentToolMessages, threshold + 1); // Higher threshold for tools

  // Check for AI message loops (repeated tool calls)
  const recentAIMessages = messages
    .filter((msg) => msg instanceof AIMessage)
    .slice(-8)
    .map((msg) => {
      const toolCalls = (msg as AIMessage).tool_calls || [];
      return toolCalls
        .map((tc) => `${tc.name}:${JSON.stringify(tc.args)}`)
        .join("|");
    })
    .filter((calls) => calls.length > 0);

  const aiLoop = checkMessageLoop(recentAIMessages, threshold);

  // Determine if any loop should cause termination
  const hasActualProgress = messages.some(
    (msg) =>
      msg instanceof ToolMessage &&
      typeof msg.content === "string" &&
      (msg.content.includes("✅ Successfully wrote") ||
        msg.content.includes("Command executed successfully") ||
        msg.content.includes("Task completed"))
  );

  const shouldTerminate =
    (humanLoop.hasLoop && humanLoop.count! >= 5) ||
    (toolLoop.hasLoop && toolLoop.count! >= 6 && !hasActualProgress) ||
    (aiLoop.hasLoop && aiLoop.count! >= 4);

  // Return the most significant loop
  if (humanLoop.hasLoop) {
    return { ...humanLoop, shouldTerminate, toolLoop: false };
  }
  if (toolLoop.hasLoop) {
    return { ...toolLoop, shouldTerminate, toolLoop: true };
  }
  if (aiLoop.hasLoop) {
    return { ...aiLoop, shouldTerminate, toolLoop: false };
  }

  return { hasLoop: false };
}

function checkMessageLoop(messages: string[], threshold: number) {
  if (messages.length < threshold) {
    return { hasLoop: false };
  }

  const lastMessage = messages[messages.length - 1];
  const repetitionCount = messages.filter((msg) => msg === lastMessage).length;

  if (repetitionCount >= threshold) {
    return {
      hasLoop: true,
      pattern: lastMessage.slice(0, 50),
      count: repetitionCount,
    };
  }

  return { hasLoop: false };
}

/**
 * Enhanced message compression with tool message prioritization
 */
export function compressMessageHistory(
  messages: BaseMessage[],
  maxLength: number = 25
): BaseMessage[] {
  if (messages.length <= maxLength) return messages;

  const compressed: BaseMessage[] = [];

  // Always keep the first system message
  const systemMessage = messages.find((msg) => msg instanceof SystemMessage);
  if (systemMessage) compressed.push(systemMessage);

  // Keep the most recent messages
  const recentMessages = messages
    .slice(-15)
    .filter((msg) => !(msg instanceof SystemMessage));

  // Keep important milestone messages (successful operations and completions)
  const milestones = messages
    .filter((msg) => {
      if (!(msg instanceof ToolMessage)) return false;

      const analysis = analyzeToolMessage(msg);
      return analysis.isSuccess || analysis.isCompletion;
    })
    .slice(-5); // Keep last 5 important tool messages

  // Keep the last few AI messages that led to tool calls
  const recentAIWithTools = messages
    .filter(
      (msg) => msg instanceof AIMessage && (msg as AIMessage).tool_calls?.length
    )
    .slice(-3);

  // Combine and deduplicate
  const combined = [
    ...compressed,
    ...milestones,
    ...recentAIWithTools,
    ...recentMessages,
  ];

  // Final deduplication with aggressive tool filtering
  return filterRepetitiveMessagesAdvanced(combined, {
    aggressiveMode: true,
    aggressiveToolFiltering: true,
    preserveToolMessages: false,
  });
}

/**
 * Master filter function with enhanced tool message handling
 */
export function masterMessageFilter(
  messages: BaseMessage[],
  options: {
    enableCompression?: boolean;
    maxHistoryLength?: number;
    autoTerminateLoops?: boolean;
    aggressiveToolFiltering?: boolean;
  } = {}
): {
  messages: BaseMessage[];
  loopDetected: boolean;
  shouldTerminate: boolean;
  stats: {
    original: number;
    filtered: number;
    removed: number;
    toolMessagesRemoved: number;
  };
} {
  const {
    enableCompression = true,
    maxHistoryLength = 25,
    autoTerminateLoops = false,
    aggressiveToolFiltering = true,
  } = options;

  const originalCount = messages.length;
  const originalToolCount = messages.filter(
    (m) => m instanceof ToolMessage
  ).length;

  // Step 1: Detect loops with enhanced tool awareness
  const loopInfo = detectRepetitiveLoop(messages);

  if (loopInfo.hasLoop) {
    console.log(
      `🔄 ${loopInfo.toolLoop ? "Tool" : "Message"} loop detected: "${
        loopInfo.pattern
      }" repeated ${loopInfo.count} times`
    );
  }

  // Step 2: Apply aggressive filtering with enhanced tool filtering
  let filtered = filterRepetitiveMessagesAdvanced(messages, {
    maxDuplicates: 2,
    recentWindowSize: 10,
    aggressiveMode: true,
    aggressiveToolFiltering,
    preserveToolMessages: false, // Don't preserve redundant tool messages
  });

  // Step 3: Compress if needed
  if (enableCompression && filtered.length > maxHistoryLength) {
    filtered = compressMessageHistory(filtered, maxHistoryLength);
  }

  // Step 4: Final system message cleanup
  filtered = cleanupSystemMessages(filtered);

  const finalCount = filtered.length;
  const finalToolCount = filtered.filter(
    (m) => m instanceof ToolMessage
  ).length;
  const toolMessagesRemoved = originalToolCount - finalToolCount;

  return {
    messages: filtered,
    loopDetected: loopInfo.hasLoop,
    shouldTerminate: autoTerminateLoops && !!loopInfo.shouldTerminate,
    stats: {
      original: originalCount,
      filtered: finalCount,
      removed: originalCount - finalCount,
      toolMessagesRemoved,
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

// Legacy exports for backward compatibility with enhanced filtering
export const filterMessages = (messages: BaseMessage[]): BaseMessage[] => {
  const result = masterMessageFilter(messages, {
    enableCompression: false,
    autoTerminateLoops: false,
    aggressiveToolFiltering: true,
  });
  return result.messages;
};

export const filterAllRepetitiveMessages = (
  messages: BaseMessage[],
  windowSize: number = 8,
  threshold: number = 2
): BaseMessage[] => {
  return filterRepetitiveMessagesAdvanced(messages, {
    maxDuplicates: threshold,
    recentWindowSize: windowSize,
    aggressiveMode: true,
    aggressiveToolFiltering: true,
    preserveToolMessages: false,
  });
};

export const detectRepetitivePattern = (
  messages: BaseMessage[],
  windowSize: number = 8,
  threshold: number = 3
): boolean => {
  const result = detectRepetitiveLoop(messages, threshold);
  return result.hasLoop;
};
