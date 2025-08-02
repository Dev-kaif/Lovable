import { z } from "zod";
import { baseProcedure, createTRPCRouter } from "../init";
import { inngest } from "@/inngest/client";
import { Sandbox } from "@e2b/code-interpreter";

// In-memory store for session sandboxes (in production, use Redis or database)
const sessionSandboxes = new Map<string, string>();

export const appRouter = createTRPCRouter({
  // Create or get sandbox for a session
  getSandbox: baseProcedure
    .input(
      z.object({
        sessionId: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const sessionId = input.sessionId || `session-${Date.now()}`;

      // Check if sandbox already exists for this session
      let sandboxId = sessionSandboxes.get(sessionId);

      if (!sandboxId) {
        console.log(`🆕 Creating new sandbox for session: ${sessionId}`);

        // Create a new sandbox for this session
        const sandbox = await Sandbox.create("lovable-kaif-1try", {
          timeoutMs: 3 * 300_000, // 15 minutes timeout
        });

        sandboxId = sandbox.sandboxId;
        sessionSandboxes.set(sessionId, sandboxId);

        console.log(`✅ Created sandbox ${sandboxId} for session ${sessionId}`);
      } else {
        console.log(
          `♻️ Reusing existing sandbox ${sandboxId} for session ${sessionId}`
        );
      }

      return {
        sessionId,
        sandboxId,
        threadId: `thread-${sessionId}`,
      };
    }),

  // Send query to AI agent with existing sandbox
  invoke: baseProcedure
    .input(
      z.object({
        query: z.string(),
        sessionId: z.string(),
        threadId: z.string().optional(),
        sandboxId: z.string(), // Now required
      })
    )
    .mutation(async ({ input }) => {
      const threadId = input.threadId || `thread-${input.sessionId}`;

      console.log(
        `🚀 Invoking AI agent with sandbox ${input.sandboxId} for session ${input.sessionId}`
      );

      await inngest.send({
        name: "aiAgent",
        data: {
          query: input.query,
          sessionId: input.sessionId,
          threadId: threadId,
          sandboxId: input.sandboxId, // Pass the existing sandbox ID
        },
      });

      return {
        sessionId: input.sessionId,
        threadId,
        sandboxId: input.sandboxId,
      };
    }),

  // Optional: Clean up sandbox when session ends
  cleanupSandbox: baseProcedure
    .input(
      z.object({
        sessionId: z.string(),
      })
    )
    .mutation(async ({ input }) => {
      const sandboxId = sessionSandboxes.get(input.sessionId);

      if (sandboxId) {
        try {
          // Note: E2B sandboxes auto-cleanup after timeout, but you can manually cleanup if needed
          console.log(
            `🧹 Cleaning up sandbox ${sandboxId} for session ${input.sessionId}`
          );
          sessionSandboxes.delete(input.sessionId);
          return {
            success: true,
            message: `Cleaned up session ${input.sessionId}`,
          };
        } catch (error) {
          console.error(
            `❌ Failed to cleanup sandbox for session ${input.sessionId}:`,
            error
          );
          return {
            success: false,
            message: `Failed to cleanup session: ${error}`,
          };
        }
      }

      return {
        success: false,
        message: `No sandbox found for session ${input.sessionId}`,
      };
    }),

  hello_3: baseProcedure
    .input(
      z.object({
        text: z.string(),
      })
    )
    .query((options) => {
      return {
        greeting: `hello ${options.input.text} you are best`,
      };
    }),
});

// export type definition of API
export type AppRouter = typeof appRouter;
