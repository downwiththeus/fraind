import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { buildSystemPrompt } from "./personality";

const MODEL = "google/gemini-3-flash-preview";
const GATEWAY = "https://ai.gateway.lovable.dev/v1/chat/completions";

function makeSlug() {
  const chars = "abcdefghjkmnpqrstuvwxyz23456789";
  let s = "";
  for (let i = 0; i < 10; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

/** Generate provocative "spark seeds" — short prompts for thought experiments. */
export const generateSparks = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({
    flavor: z.enum(["any", "what_if", "world_building", "remix", "absurd", "ethical"]).default("any"),
  }).parse(d))
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;
    const apiKey = process.env.LOVABLE_API_KEY;
    if (!apiKey) throw new Error("LOVABLE_API_KEY missing");

    const [{ data: profile }, { data: memories }] = await Promise.all([
      supabase.from("profiles").select("display_name").eq("user_id", userId).maybeSingle(),
      supabase.from("memories").select("content,importance").order("importance", { ascending: false }).limit(20),
    ]);

    const memBlock = (memories ?? []).map((m) => `• ${m.content}`).join("\n") || "(nothing yet)";
    const flavorHint: Record<string, string> = {
      any: "Mix the flavors freely.",
      what_if: "All prompts should be 'what if…' counterfactuals.",
      world_building: "All prompts should be world-building seeds (a culture, a city, a physics).",
      remix: "All prompts should mash up two unrelated domains.",
      absurd: "All prompts should be playful, absurd, or surreal.",
      ethical: "All prompts should be ethical dilemmas with no clean answer.",
    };

    const system = buildSystemPrompt({ mode: "playground", displayName: profile?.display_name, memories: memories ?? [] });

    const res = await fetch(GATEWAY, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          { role: "system", content: system },
          { role: "user", content: `Generate 6 SPARK SEEDS — short (1-2 sentence) provocations to start a thought experiment with me. ${flavorHint[data.flavor]} Lean into what you already know about them. Each seed should be specific, weird, and immediately playable. No numbering, no preamble — just the seeds via the tool.

WHAT YOU REMEMBER:
${memBlock}` },
        ],
        tools: [{
          type: "function",
          function: {
            name: "emit_sparks",
            description: "Return spark seeds.",
            parameters: {
              type: "object",
              properties: {
                sparks: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      title: { type: "string", description: "Short, evocative 2-5 word title." },
                      prompt: { type: "string", description: "The 1-2 sentence provocation itself." },
                      tag: { type: "string", description: "One-word vibe tag (e.g. 'what-if', 'remix', 'absurd')." },
                    },
                    required: ["title", "prompt", "tag"],
                    additionalProperties: false,
                  },
                },
              },
              required: ["sparks"],
              additionalProperties: false,
            },
          },
        }],
        tool_choice: { type: "function", function: { name: "emit_sparks" } },
      }),
    });

    if (!res.ok) {
      if (res.status === 429) throw new Error("Too many requests right now. Try again in a moment.");
      if (res.status === 402) throw new Error("AI credits exhausted.");
      throw new Error("AI gateway error");
    }
    const body = await res.json();
    const call = body.choices?.[0]?.message?.tool_calls?.[0];
    if (!call) throw new Error("No sparks returned");
    const args = JSON.parse(call.function.arguments);
    return { sparks: (args.sparks ?? []).slice(0, 6) as { title: string; prompt: string; tag: string }[] };
  });

/** Save a spark as a shareable seed (returns slug). */
export const shareSpark = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({
    title: z.string().min(1).max(120),
    prompt: z.string().min(2).max(2000),
    tag: z.string().max(40).optional(),
  }).parse(d))
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;
    // Try up to 3 times for unique slug
    for (let i = 0; i < 3; i++) {
      const slug = makeSlug();
      const { data: row, error } = await supabase
        .from("spark_seeds")
        .insert({ owner_id: userId, slug, title: data.title, prompt: data.prompt, tag: data.tag ?? null })
        .select()
        .single();
      if (!error) return row;
      if (!String(error.message).includes("duplicate")) throw new Error(error.message);
    }
    throw new Error("Could not generate a unique slug, try again.");
  });

/** Create or reopen a conversation from a saved seed. */
export const playSeed = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ seedId: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;
    const { data: seed, error: sErr } = await supabase.from("spark_seeds").select("*").eq("id", data.seedId).maybeSingle();
    if (sErr) throw new Error(sErr.message);
    if (!seed) throw new Error("Seed not found");

    // Reopen existing thread for this user/seed if any
    const { data: existing } = await supabase
      .from("conversations")
      .select("*")
      .eq("user_id", userId)
      .eq("seed_id", seed.id)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (existing) return existing;

    const { data: conv, error } = await supabase
      .from("conversations")
      .insert({ user_id: userId, mode: "playground", title: seed.title, seed_id: seed.id })
      .select()
      .single();
    if (error) throw new Error(error.message);

    await supabase.from("messages").insert({
      conversation_id: conv.id,
      user_id: userId,
      role: "assistant",
      content: seed.prompt,
    });
    return conv;
  });

/** Legacy: play a spark directly (creates seed under the hood for shareability). */
export const playSpark = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({
    title: z.string().min(1).max(120),
    prompt: z.string().min(2).max(2000),
    tag: z.string().max(40).optional(),
  }).parse(d))
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;
    let seedId: string | null = null;
    for (let i = 0; i < 3; i++) {
      const slug = makeSlug();
      const { data: seed, error } = await supabase
        .from("spark_seeds")
        .insert({ owner_id: userId, slug, title: data.title, prompt: data.prompt, tag: data.tag ?? null })
        .select("id")
        .single();
      if (!error) { seedId = seed.id; break; }
      if (!String(error.message).includes("duplicate")) break;
    }

    const { data: conv, error } = await supabase
      .from("conversations")
      .insert({ user_id: userId, mode: "playground", title: data.title, seed_id: seedId })
      .select()
      .single();
    if (error) throw new Error(error.message);

    await supabase.from("messages").insert({
      conversation_id: conv.id,
      user_id: userId,
      role: "assistant",
      content: data.prompt,
    });
    return conv;
  });

/** Public: fetch a shared seed by slug (no auth required). */
export const getSharedSeed = createServerFn({ method: "GET" })
  .inputValidator((d) => z.object({ slug: z.string().min(1).max(60) }).parse(d))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: row, error } = await supabaseAdmin
      .from("spark_seeds")
      .select("id,slug,title,prompt,tag,created_at")
      .eq("slug", data.slug)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!row) throw new Error("Seed not found");
    return row;
  });

/** List all spark seeds the current user has created or played. */
export const listMySeeds = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data, error } = await supabase
      .from("spark_seeds")
      .select("id,slug,title,prompt,tag,created_at")
      .eq("owner_id", userId)
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) throw new Error(error.message);
    return data ?? [];
  });
