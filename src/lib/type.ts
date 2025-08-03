/* eslint-disable @typescript-eslint/no-explicit-any */
import type { Sandbox } from "@e2b/code-interpreter";
import { BaseMessage } from "@langchain/core/messages";
import { Annotation, END } from "@langchain/langgraph";

export const GraphAnnotation = Annotation.Root({
  messages: Annotation<BaseMessage[]>({
    reducer: (left, right) => {
      console.log(
        `📝 Message reducer - left: ${left?.length || 0}, right: ${
          Array.isArray(right) ? right.length : 1
        }`
      );
      const result = left.concat(Array.isArray(right) ? right : [right]);
      console.log(`📝 Message reducer result: ${result.length} total messages`);
      return result;
    },
    default: () => [],
  }),
  step: Annotation<any>({
    reducer: (left, right) => right ?? left,
  }),
  network: Annotation<any>({
    reducer: (left, right) => {
      if (!right) return left;
      if (!left) return right;
      // Deep merge network data
      const merged = {
        ...left,
        data: {
          ...left.data,
          ...right.data,
        },
      };
      console.log(`🌐 Network reducer - merged data:`, merged.data);
      return merged;
    },
  }),
  sandbox: Annotation<Sandbox>({
    reducer: (left, right) => right ?? left,
  }),
  lastToolCallId: Annotation<string | null>({
    reducer: (left, right) => right ?? left,
  }),
  next: Annotation<"tools" | typeof END | null>({
    reducer: (left, right) => right ?? left,
  }),
  mainTaskExecuted: Annotation<boolean>({
    reducer: (left, right) => {
      const result = right ?? left;
      console.log(
        `🎯 MainTaskExecuted reducer - left: ${left}, right: ${right}, result: ${result}`
      );
      return result;
    },
    default: () => false,
  }),
  hasWriteErrors: Annotation<boolean>({
    reducer: (left, right) => {
      const result = right ?? left;
      console.log(
        `❌ HasWriteErrors reducer - left: ${left}, right: ${right}, result: ${result}`
      );
      return result;
    },
    default: () => false,
  }),
});

export type GraphState = typeof GraphAnnotation.State;

// Enhanced interface for better type safety
export interface NetworkData {
  files?: any[];
  writtenFiles?: Record<string, string>;
  lastReadFiles?: string | null;
}

