import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { buildSystemPrompt } from "./personality";

const MODEL = "google/gemini-3-flash-preview";
const GATEWAY = "https://ai.gateway.lovable.dev/v1/chat/completions";

export const listWonderReports = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase } = context;
    const { data, error } = await supabase
      .from("wonder_reports")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(30);
    if (error) throw new Error(error.message);
    return data;
  });

export const generateWonderReport = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const apiKey = process.env.LOVABLE_API_KEY;
    if (!apiKey) throw new Error("LOVABLE_API_KEY missing");

    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const [{ data: profile }, { data: memories }, { data: msgs }, { data: feedback }] = await Promise.all([
      supabase.from("profiles").select("display_name").eq("user_id", userId).maybeSingle(),
      supabase.from("memories").select("content,importance").order("importance", { ascending: false }).limit(40),
      supabase.from("messages").select("id,role,content,created_at").gte("created_at", since).order("created_at").limit(200),
      supabase.from("message_feedback").select("message_id,smile,sentiment,note").gte("created_at", since),
    ]);

    if (!msgs || msgs.length === 0) {
      throw new Error("No conversations this week — go think out loud with me first.");
    }

    const fbMap = new Map((feedback ?? []).map((f) => [f.message_id, f]));
    const smiles = msgs.filter((m) => fbMap.get(m.id)?.smile);
    const lovedBlock = smiles.length
      ? smiles.slice(0, 8).map((m) => `😊 [${m.role}] ${m.content.slice(0, 240)}${fbMap.get(m.id)?.note ? ` — note: "${fbMap.get(m.id)!.note}"` : ""}`).join("\n")
      : "(no smile-rated moments this week)";

    const sentiments = (feedback ?? []).map((f) => f.sentiment ?? 0);
    const smileRate = feedback && feedback.length
      ? Math.round(((feedback.filter((f) => f.smile).length) / feedback.length) * 100)
      : 0;
    const avgSent = sentiments.length ? (sentiments.reduce((a, b) => a + b, 0) / sentiments.length).toFixed(2) : "n/a";

    const transcript = msgs.map((m) => `${m.role.toUpperCase()}: ${m.content.slice(0, 400)}`).join("\n\n");
    const system = buildSystemPrompt({ mode: "companion", displayName: profile?.display_name, memories: memories ?? [] });

    const res = await fetch(GATEWAY, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          { role: "system", content: system },
          { role: "user", content: `Write this week's WONDER REPORT for ${profile?.display_name || "them"} — a short, beautiful summary of the most interesting ideas, threads, and questions. Format with markdown. 4-6 short sections with evocative headings.

INCLUDE A SECTION called "What made you smile" that draws from the WHAT-MADE-THEM-HAPPIEST block below. Quote them sparingly. Surface one thread to pull on next week. End with a single startling question.

This week's signal:
- smile rate: ${smileRate}%
- average sentiment: ${avgSent} (–1 to 1)

WHAT MADE THEM HAPPIEST (their starred / smiled-at moments):
${lovedBlock}

TRANSCRIPT:
${transcript.slice(0, 13000)}` },
        ],
      }),
    });
    if (!res.ok) throw new Error("AI gateway error");
    const body = await res.json();
    const content = body.choices?.[0]?.message?.content as string;
    if (!content) throw new Error("Empty response");

    const title = `Wonder Report — ${new Date().toLocaleDateString(undefined, { month: "short", day: "numeric" })}`;
    const { data: row, error } = await supabase.from("wonder_reports").insert({
      user_id: userId, title, body: content,
    }).select().single();
    if (error) throw new Error(error.message);
    return row;
  });
