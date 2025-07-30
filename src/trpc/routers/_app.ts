import { z } from "zod";
import { baseProcedure, createTRPCRouter } from "../init";

export const appRouter = createTRPCRouter({
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
