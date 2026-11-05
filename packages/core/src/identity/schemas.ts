// Server-side validation schemas (spec §1: Zod is the single source of truth;
// issue #3: server-side validation with Zod + inline field errors).
import { z } from "zod";
import type { AppErrorDetail } from "../bridge.js";

export const RegisterInputSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(100, "Name is too long").optional(),
  email: z
    .string()
    .trim()
    .toLowerCase()
    .pipe(z.email("Enter a valid email address")),
  password: z.string().min(8, "Use at least 8 characters").max(200, "Password is too long"),
});
export type RegisterInput = z.infer<typeof RegisterInputSchema>;

export const LoginInputSchema = z.object({
  email: z
    .string()
    .trim()
    .toLowerCase()
    .pipe(z.email("Enter a valid email address")),
  password: z.string().min(1, "Password is required"),
});
export type LoginInput = z.infer<typeof LoginInputSchema>;

/** Map a ZodError to the spec §4 `details` shape for inline field errors. */
export function zodToDetails(error: z.ZodError): AppErrorDetail[] {
  return error.issues.map((issue) => ({
    path: issue.path.map(String).join(".") || "form",
    message: issue.message,
  }));
}
