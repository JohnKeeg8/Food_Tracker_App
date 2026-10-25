function flag(value: string | undefined, fallback: boolean) {
  if (value === undefined || value === "") return fallback;
  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
}

export const config = {
  port: Number(process.env.PORT ?? 8080),
  allowSignup: flag(process.env.ALLOW_SIGNUP, true),
  signupCode: process.env.SIGNUP_CODE || undefined,
  anthropicApiKey: process.env.ANTHROPIC_API_KEY || undefined,
  claudeModel: process.env.CLAUDE_MODEL || "claude-opus-5-5",
};
