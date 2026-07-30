import { z } from "zod";

/**
 * Parse and validate environment variables at process startup. Fails fast with a
 * readable list of every missing/invalid variable instead of dying one at a time.
 *
 * Usage:
 *   const env = parseEnv({
 *     DATABASE_URL: z.string().url(),
 *     API_PORT: portSchema.default(4000),
 *   });
 */
export function parseEnv<T extends z.ZodRawShape>(
  shape: T,
  source: Record<string, string | undefined> = process.env,
): z.infer<z.ZodObject<T>> {
  const parsed = z.object(shape).safeParse(source);
  if (!parsed.success) {
    const lines = parsed.error.issues.map(
      (issue) => `  - ${issue.path.join(".") || "(root)"}: ${issue.message}`,
    );
    throw new Error(`Invalid environment configuration:\n${lines.join("\n")}`);
  }
  return parsed.data;
}

/** Coerces "4000" → 4000 and validates the port range. */
export const portSchema = z.coerce.number().int().min(1).max(65535);

/** Common toggle: "true"/"1" → true, everything else → false. */
export const booleanFlagSchema = z
  .string()
  .optional()
  .transform((v) => v === "true" || v === "1");
