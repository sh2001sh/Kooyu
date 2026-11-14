import { z } from "zod";

export const onboardingUpdateSchema = z
  .object({
    expectedRevision: z.number().int().nonnegative(),
    step: z.number().int().min(0).max(2),
    status: z.enum(["active", "completed", "skipped"]),
  })
  .strict();
export interface OnboardingState {
  version: 1;
  revision: number;
  step: number;
  status: "active" | "completed" | "skipped";
  updatedAt: string;
}
