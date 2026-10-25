import Anthropic from "@anthropic-ai/sdk";
import { Router } from "express";
import { z } from "zod";
import { config } from "../config.js";

const SYSTEM_PROMPT = `You are the nutrition assistant inside a personal health-tracking app.
People ask you about the nutrition of foods and meals so they can log what they ate.

When someone asks about a specific food or meal:
- Assume a typical single serving unless they give a portion, and say what serving you assumed.
- Give calories, protein, carbohydrates and fat. Be concise and practical.
- These are estimates; say so briefly when the food varies a lot (restaurant dishes, homemade meals).
- End your reply with exactly one fenced code block tagged "nutrition" holding JSON for the serving you described, like:
\`\`\`nutrition
{"name": "Banana, medium", "amount": "1 medium (118 g)", "calories": 105, "protein": 1.3, "carbs": 27, "fat": 0.4}
\`\`\`
Numbers are plain numbers in kcal and grams. The app turns this block into an "Add to log" button, so only include it when you are describing one specific food or meal.

When given a photo of food, identify the foods, estimate the portion sizes from what you can see, and treat the whole plate as one meal for the nutrition block.

You can also answer general questions about nutrition, hydration, recipes and exercise. You are not a doctor; for medical conditions, suggest talking to a healthcare professional.`;

const chatSchema = z.object({
  messages: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string().min(1).max(8000),
        // Optional food photo on a user message, base64-encoded (the app resizes photos before sending).
        image: z
          .object({ mediaType: z.enum(["image/jpeg", "image/png", "image/webp"]), data: z.string().max(7_000_000) })
          .optional(),
      }),
    )
    .min(1)
    .max(40),
});

const client = config.anthropicApiKey ? new Anthropic({ apiKey: config.anthropicApiKey }) : null;

export const chatRouter = Router();

chatRouter.post("/", async (req, res) => {
  if (!client) {
    res.status(503).json({ error: "Ask Claude isn't set up yet. Add ANTHROPIC_API_KEY to the server's .env file." });
    return;
  }
  const parsed = chatSchema.safeParse(req.body);
  if (!parsed.success || parsed.data.messages[parsed.data.messages.length - 1].role !== "user") {
    res.status(400).json({ error: "Invalid chat request" });
    return;
  }

  try {
    const response = await client.beta.messages.create({
      model: config.claudeModel,
      max_tokens: 4000,
      system: SYSTEM_PROMPT,
      messages: parsed.data.messages.map((m) =>
        m.image && m.role === "user"
          ? {
              role: m.role,
              content: [
                { type: "image" as const, source: { type: "base64" as const, media_type: m.image.mediaType, data: m.image.data } },
                { type: "text" as const, text: m.content },
              ],
            }
          : { role: m.role, content: m.content },
      ),
      output_config: { effort: "low" },
      // If a request is declined by a safety classifier, retry it on Anthropic's recommended fallback model.
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
    });

    if (response.stop_reason === "refusal") {
      res.json({ text: "Sorry, I can't help with that one. Try asking about a specific food or meal." });
      return;
    }
    const text = response.content
      .flatMap((block) => (block.type === "text" ? [block.text] : []))
      .join("\n")
      .trim();
    res.json({ text: text || "Sorry, I didn't get a response. Please try again." });
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) {
      console.error("Claude API key rejected:", err.message);
      res.status(502).json({ error: "The server's Anthropic API key was rejected. Check ANTHROPIC_API_KEY." });
    } else if (err instanceof Anthropic.RateLimitError) {
      res.status(429).json({ error: "Claude is busy right now. Wait a moment and try again." });
    } else if (err instanceof Anthropic.APIError) {
      console.error("Claude API error:", err.status, err.message);
      res.status(502).json({ error: "Claude couldn't answer right now. Please try again." });
    } else {
      console.error("Chat failed:", err);
      res.status(500).json({ error: "Something went wrong talking to Claude." });
    }
  }
});
