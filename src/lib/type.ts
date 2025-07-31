/* eslint-disable @typescript-eslint/no-explicit-any */
import type { Sandbox } from "@e2b/code-interpreter";
import { BaseMessage } from "@langchain/core/messages";

// type GraphState = {
//   messages: BaseMessage[];
//   step: any;
//   network: any;
//   sandbox: Sandbox;
// };

import { Annotation, END } from "@langchain/langgraph";

export const GraphAnnotation = Annotation.Root({
  messages: Annotation<BaseMessage[]>({
    reducer: (left, right) =>
      left.concat(Array.isArray(right) ? right : [right]),
    default: () => [],
  }),
  step: Annotation<any>(),
  network: Annotation<any>(),
  sandbox: Annotation<Sandbox>(),
  lastToolCallId: Annotation<string | null>(),
  next: Annotation<"tools" | typeof END | null>(),
  mainTaskExecuted: Annotation<boolean>(),
});

export type GraphState = typeof GraphAnnotation.State;
