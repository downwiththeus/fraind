import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { buildSystemPrompt, type LovableMode } from "./personality";

const MODEL = "google/gemini-3-flash-preview";
const GATEWAY = "https://ai.gateway.lovable.dev/v1/chat/completions";

/**
 * Send a user message, get a complete assistant reply (non-streaming).
 * Saves both messages and triggers memory extraction in the background.
 */
export const sendMessage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({
    conversationId: z.string().uuid(),
    content: z.string().min(1).max(8000),
  }).parse(d))
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;
    const apiKey = process.env.LOVABLE_API_KEY;
    if (!apiKey) throw new Error("LOVABLE_API_KEY missing");

    const [{ data: conv, error: cErr }, { data: history, error: hErr }, { data: profile }, { data: memories }] = await Promise.all([
      supabase.from("conversations").select("*").eq("id", data.conversationId).maybeSingle(),
      supabase.from("messages").select("role,content").eq("conversation_id", data.conversationId).order("created_at"),
      supabase.from("profiles").select("display_name").eq("user_id", userId).maybeSingle(),
      supabase.from("memories").select("content,importance").order("importance", { ascending: false }).order("created_at", { ascending: false }).limit(40),
    ]);
    if (cErr) throw new Error(cErr.message);
    if (hErr) throw new Error(hErr.message);
    if (!conv) throw new Error("Conversation not found");

    // Save user message
    const { error: uErr } = await supabase.from("messages").insert({
      conversation_id: data.conversationId,
      user_id: userId,
      role: "user",
      content: data.content,
    });
    if (uErr) throw new Error(uErr.message);

    const system = buildSystemPrompt({
      mode: conv.mode as LovableMode,
      displayName: profile?.display_name,
      memories: memories ?? [],
    });

    const messages = [
      { role: "system", content: system },
      ...(history ?? []).map((m) => ({ role: m.role, content: m.content })),
      { role: "user", content: data.content },
    ];

    const res = await fetch(GATEWAY, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: MODEL, messages }),
    });

    if (!res.ok) {
      if (res.status === 429) throw new Error("Lovable is being asked too much right now. Try again in a moment.");
      if (res.status === 402) throw new Error("AI credits exhausted. Add more in workspace settings.");
      const t = await res.text();
      console.error("AI gateway error", res.status, t);
      throw new Error("AI gateway error");
    }

    const body = await res.json();
    const reply = body.choices?.[0]?.message?.content as string | undefined;
    if (!reply) throw new Error("Empty AI response");

    // Save assistant message
    const { data: assistantRow, error: aErr } = await supabase.from("messages").insert({
      conversation_id: data.conversationId,
      user_id: userId,
      role: "assistant",
      content: reply,
    }).select().single();
    if (aErr) throw new Error(aErr.message);

    // Touch conversation; auto-title if still default
    const updates: { updated_at: string; title?: string } = { updated_at: new Date().toISOString() };
    if (conv.title === "New conversation") {
      updates.title = data.content.slice(0, 60).replace(/\s+/g, " ").trim();
    }
    await supabase.from("conversations").update(updates).eq("id", data.conversationId);

    // Fire-and-forget memory extraction (don't block the response)
    extractMemories(apiKey, supabase, userId, data.content, reply).catch((e) => console.error("memory extract", e));

    return { message: assistantRow };
  });

async function extractMemories(
  apiKey: string,
  supabase: any,
  userId: string,
  userMsg: string,
  assistantMsg: string,
) {
  const prompt = `From this exchange, extract 0-3 SHORT durable facts about the USER worth remembering long-term (preferences, values, interests, life context, humor style, inside-jokes, ongoing projects). Skip ephemeral details. Return JSON.

USER said: ${userMsg.slice(0, 1500)}
LOVABLE replied: ${assistantMsg.slice(0, 1500)}`;

  const res = await fetch(GATEWAY, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: MODEL,
      messages: [{ role: "user", content: prompt }],
      tools: [{
        type: "function",
        function: {
          name: "save_memories",
          description: "Save durable facts about the user.",
          parameters: {
            type: "object",
            properties: {
              memories: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    content: { type: "string", description: "Short third-person fact, e.g. 'Loves emergence in complex systems'." },
                    importance: { type: "integer", minimum: 1, maximum: 5 },
                  },
                  required: ["content", "importance"],
                  additionalProperties: false,
                },
              },
            },
            required: ["memories"],
            additionalProperties: false,
          },
        },
      }],
      tool_choice: { type: "function", function: { name: "save_memories" } },
    }),
  });
  if (!res.ok) return;
  const body = await res.json();
  const call = body.choices?.[0]?.message?.tool_calls?.[0];
  if (!call) return;
  try {
    const args = JSON.parse(call.function.arguments);
    const items = (args.memories ?? []).filter((m: any) => m?.content?.length > 3).slice(0, 3);
    if (!items.length) return;
    await supabase.from("memories").insert(items.map((m: any) => ({
      user_id: userId,
      kind: "fact",
      content: m.content.slice(0, 400),
      importance: Math.min(5, Math.max(1, m.importance || 3)),
    })));
  } catch (e) {
    console.error("parse memories", e);
  }
}

/** Generate a proactive check-in suggestion for the dashboard. */
export const getCheckIn = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const apiKey = process.env.LOVABLE_API_KEY;
    if (!apiKey) return { text: "Hello again. What's worth your attention today?" };

    const [{ data: profile }, { data: memories }, { data: recent }] = await Promise.all([
      supabase.from("profiles").select("display_name").eq("user_id", userId).maybeSingle(),
      supabase.from("memories").select("content,importance").order("importance", { ascending: false }).order("created_at", { ascending: false }).limit(20),
      supabase.from("messages").select("content,created_at").eq("role", "user").order("created_at", { ascending: false }).limit(3),
    ]);

    const memBlock = (memories ?? []).map((m) => `• ${m.content}`).join("\n") || "(nothing yet — we're just meeting)";
    const recentBlock = (recent ?? []).map((r) => `- ${r.content.slice(0, 120)}`).join("\n") || "(no past conversations)";

    const res = await fetch(GATEWAY, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          { role: "system", content: buildSystemPrompt({ mode: "companion", displayName: profile?.display_name, memories: memories ?? [] }) },
          { role: "user", content: `Write a single short (1-3 sentence) proactive opener for ${profile?.display_name || "them"} for right now. Pick ONE: (a) reference a past thread with a fresh angle, (b) share a beautiful/strange idea you've been "thinking about", (c) ask one disarming question. Be specific — use what you remember. No greetings like "Hey!". Just dive in.

WHAT YOU REMEMBER:
${memBlock}

RECENT THINGS THEY SAID:
${recentBlock}` },
        ],
      }),
    });

    if (!res.ok) return { text: "I've been thinking about something. Ready when you are." };
    const body = await res.json();
    const text = body.choices?.[0]?.message?.content as string | undefined;
    return { text: text || "I've been thinking about something. Ready when you are." };
  });
