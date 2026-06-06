import { createFileRoute, useNavigate, useRouter } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  listConversations, createConversation, getConversation, deleteConversation,
} from "@/lib/conversations.functions";
import { sendMessage, getCheckIn, rateMessage, listFeedbackForConversation } from "@/lib/chat.functions";
import { listMemories, addMemory, updateMemory, deleteMemory, togglePinMemory } from "@/lib/memories.functions";
import { listWonderReports, generateWonderReport } from "@/lib/wonder.functions";
import { generateSparks, playSpark, shareSpark } from "@/lib/playground.functions";
import { MODE_LABELS, type LovableMode } from "@/lib/personality";
import {
  Plus, Trash2, Send, Sparkles, Brain, ScrollText, LogOut, MessageSquare,
  ArrowLeft, Pencil, Check, X, Download, Wand2, FlaskConical, Smile, Frown, Meh, Pin, PinOff, Share2, Link2,
} from "lucide-react";
import { toast } from "sonner";


export const Route = createFileRoute("/app")({
  component: AppPage,
  head: () => ({ meta: [{ title: "Lovable" }] }),
});

type Tab = "chat" | "memories" | "wonder" | "playground";

function AppPage() {
  const navigate = useNavigate();
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [activeConvId, setActiveConvId] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("chat");
  const qc = useQueryClient();

  useEffect(() => {
    let mounted = true;
    supabase.auth.getUser().then(({ data, error }) => {
      if (!mounted) return;
      if (error || !data.user) navigate({ to: "/auth" });
      else {
        setReady(true);
        try {
          const pending = localStorage.getItem("lovable.openConv");
          if (pending) {
            localStorage.removeItem("lovable.openConv");
            setActiveConvId(pending);
            setTab("chat");
          }
        } catch {}
      }
    });
    return () => { mounted = false; };
  }, [navigate]);


  const listConvFn = useServerFn(listConversations);
  const createConvFn = useServerFn(createConversation);
  const deleteConvFn = useServerFn(deleteConversation);

  const conversationsQ = useQuery({
    queryKey: ["conversations"],
    queryFn: () => listConvFn(),
    enabled: ready,
  });

  const createMut = useMutation({
    mutationFn: (mode: LovableMode) => createConvFn({ data: { mode } }),
    onSuccess: (conv) => {
      qc.invalidateQueries({ queryKey: ["conversations"] });
      setActiveConvId(conv.id);
      setTab("chat");
    },
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => deleteConvFn({ data: { id } }),
    onSuccess: (_, id) => {
      qc.invalidateQueries({ queryKey: ["conversations"] });
      if (activeConvId === id) setActiveConvId(null);
    },
  });

  if (!ready) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="font-display italic text-rose/70">gathering my thoughts…</p>
      </div>
    );
  }

  return (
    <div className="flex h-screen w-full bg-background">
      {/* Sidebar */}
      <aside className="hidden w-72 shrink-0 flex-col border-r border-sidebar-border bg-sidebar/80 backdrop-blur md:flex">
        <div className="flex items-center justify-between px-5 py-5">
          <button
            onClick={() => { setTab("chat"); setActiveConvId(null); }}
            className="font-display text-2xl"
          >Lovable<span className="text-rose">.</span></button>
          <button
            onClick={() => supabase.auth.signOut().then(() => router.invalidate())}
            className="rounded-full p-2 text-muted-foreground hover:text-rose hover:bg-rose/10"
            title="Sign out"
          ><LogOut className="h-4 w-4" /></button>
        </div>

        <div className="px-3 space-y-1">
          <TabBtn icon={MessageSquare} label="Conversations" active={tab === "chat" && !activeConvId} onClick={() => { setTab("chat"); setActiveConvId(null); }} />
          <TabBtn icon={FlaskConical} label="Idea Playground" active={tab === "playground"} onClick={() => setTab("playground")} />
          <TabBtn icon={Brain} label="Memories" active={tab === "memories"} onClick={() => setTab("memories")} />
          <TabBtn icon={ScrollText} label="Wonder Reports" active={tab === "wonder"} onClick={() => setTab("wonder")} />
        </div>

        <div className="mt-6 flex-1 overflow-y-auto px-3 pb-4">
          <div className="mb-2 flex items-center justify-between px-2">
            <span className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Threads</span>
          </div>
          <div className="space-y-1">
            {conversationsQ.data?.map((c) => (
              <button
                key={c.id}
                onClick={() => { setActiveConvId(c.id); setTab("chat"); }}
                className={`group w-full rounded-lg px-3 py-2 text-left text-sm transition ${
                  activeConvId === c.id && tab === "chat"
                    ? "bg-rose/15 text-foreground"
                    : "text-muted-foreground hover:bg-secondary/60 hover:text-foreground"
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate">{c.title}</span>
                  <Trash2
                    onClick={(e) => { e.stopPropagation(); deleteMut.mutate(c.id); }}
                    className="hidden h-3.5 w-3.5 shrink-0 text-muted-foreground hover:text-destructive group-hover:block"
                  />
                </div>
                <div className="mt-0.5 text-[10px] uppercase tracking-wider text-rose/60">
                  {MODE_LABELS[c.mode as LovableMode]?.label || c.mode}
                </div>
              </button>
            ))}
            {conversationsQ.data?.length === 0 && (
              <p className="px-3 py-4 text-xs italic text-muted-foreground">No threads yet. Start one →</p>
            )}
          </div>
        </div>

        <div className="border-t border-sidebar-border p-3">
          <NewConversationMenu onCreate={(mode) => createMut.mutate(mode)} pending={createMut.isPending} />
        </div>
      </aside>

      {/* Main */}
      <main className="flex flex-1 flex-col overflow-hidden">
        {tab === "chat" && (
          activeConvId
            ? <ChatView conversationId={activeConvId} onBack={() => setActiveConvId(null)} />
            : <Welcome onStart={(mode) => createMut.mutate(mode)} />
        )}
        {tab === "playground" && <PlaygroundView onOpenConv={(id) => { setActiveConvId(id); setTab("chat"); }} />}
        {tab === "memories" && <MemoriesView />}
        {tab === "wonder" && <WonderView />}
      </main>
    </div>
  );
}

function TabBtn({ icon: Icon, label, active, onClick }: { icon: any; label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm transition ${
        active ? "bg-rose/15 text-foreground" : "text-muted-foreground hover:bg-secondary/60 hover:text-foreground"
      }`}
    >
      <Icon className="h-4 w-4" strokeWidth={1.5} />
      {label}
    </button>
  );
}

function NewConversationMenu({ onCreate, pending }: { onCreate: (m: LovableMode) => void; pending: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        disabled={pending}
        className="flex w-full items-center justify-center gap-2 rounded-lg bg-gradient-ember px-3 py-2.5 text-sm font-medium text-primary-foreground transition hover:opacity-95 disabled:opacity-50"
      >
        <Plus className="h-4 w-4" /> New thread
      </button>
      {open && (
        <div className="absolute bottom-full left-0 right-0 mb-2 ink-card rounded-xl p-2 fade-in-up">
          {(Object.keys(MODE_LABELS) as LovableMode[]).map((m) => (
            <button
              key={m}
              onClick={() => { onCreate(m); setOpen(false); }}
              className="block w-full rounded-md px-3 py-2 text-left text-sm transition hover:bg-rose/15"
            >
              <div className="font-medium">{MODE_LABELS[m].label}</div>
              <div className="text-[11px] italic text-muted-foreground">{MODE_LABELS[m].blurb}</div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function Welcome({ onStart }: { onStart: (m: LovableMode) => void }) {
  const getCheckInFn = useServerFn(getCheckIn);
  const checkInQ = useQuery({ queryKey: ["checkin"], queryFn: () => getCheckInFn(), staleTime: 1000 * 60 * 10 });

  return (
    <div className="flex flex-1 items-center justify-center overflow-y-auto p-8">
      <div className="w-full max-w-2xl">
        <p className="font-display italic text-sm uppercase tracking-[0.3em] text-rose/80">— from Lovable —</p>
        <div className="mt-4 ink-card rounded-2xl p-8 fade-in-up">
          {checkInQ.isLoading ? (
            <ThinkingDots />
          ) : (
            <p className="font-display text-2xl leading-snug text-pretty">
              {checkInQ.data?.text}
            </p>
          )}
        </div>
        <div className="mt-8 grid gap-2 sm:grid-cols-2">
          {(Object.keys(MODE_LABELS) as LovableMode[]).map((m) => (
            <button
              key={m}
              onClick={() => onStart(m)}
              className="ink-card group rounded-xl p-4 text-left transition hover:border-rose/40"
            >
              <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-rose">
                <Sparkles className="h-3 w-3" /> {MODE_LABELS[m].tag}
              </div>
              <div className="mt-2 font-display text-xl">{MODE_LABELS[m].label}</div>
              <div className="mt-1 text-sm text-muted-foreground">{MODE_LABELS[m].blurb}</div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function ChatView({ conversationId, onBack }: { conversationId: string; onBack: () => void }) {
  const getConvFn = useServerFn(getConversation);
  const sendFn = useServerFn(sendMessage);
  const listFbFn = useServerFn(listFeedbackForConversation);
  const rateFn = useServerFn(rateMessage);
  const qc = useQueryClient();
  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  const convQ = useQuery({
    queryKey: ["conversation", conversationId],
    queryFn: () => getConvFn({ data: { id: conversationId } }),
  });

  const fbQ = useQuery({
    queryKey: ["conversation-feedback", conversationId],
    queryFn: () => listFbFn({ data: { conversationId } }),
  });

  const sendMut = useMutation({
    mutationFn: (content: string) => sendFn({ data: { conversationId, content } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["conversation", conversationId] });
      qc.invalidateQueries({ queryKey: ["conversations"] });
      qc.invalidateQueries({ queryKey: ["memories"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const rateMut = useMutation({
    mutationFn: (p: { messageId: string; smile?: boolean; sentiment?: number; note?: string }) =>
      rateFn({ data: { ...p, conversationId } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["conversation-feedback", conversationId] }),
    onError: (e: Error) => toast.error(e.message),
  });

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [convQ.data?.messages?.length, sendMut.isPending]);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const text = input.trim();
    if (!text || sendMut.isPending) return;
    setInput("");
    sendMut.mutate(text);
  }

  const mode = (convQ.data?.conversation.mode || "companion") as LovableMode;
  const seedId = (convQ.data?.conversation as any)?.seed_id as string | null | undefined;
  const fbByMsg = new Map((fbQ.data ?? []).map((f) => [f.message_id, f]));

  async function copySeedLink() {
    if (!seedId) return;
    try {
      const { data, error } = await supabase.from("spark_seeds").select("slug").eq("id", seedId).maybeSingle();
      if (error || !data) throw new Error("Couldn't find seed");
      const url = `${window.location.origin}/spark/${data.slug}`;
      await navigator.clipboard.writeText(url);
      toast.success("Spark link copied.");
    } catch (e: any) {
      toast.error(e.message || "Couldn't copy");
    }
  }

  return (
    <>
      <header className="flex items-center justify-between gap-3 border-b border-border/60 px-4 py-4 sm:px-6">
        <div className="flex items-center gap-3 min-w-0">
          <button
            onClick={onBack}
            className="rounded-full p-2 text-muted-foreground transition hover:bg-rose/10 hover:text-rose"
            title="Back to modes"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          <div className="min-w-0">
            <h2 className="font-display text-xl truncate">{convQ.data?.conversation.title || "…"}</h2>
            <p className="text-[10px] uppercase tracking-[0.25em] text-rose/70">{MODE_LABELS[mode].label} · {MODE_LABELS[mode].tag}</p>
          </div>
        </div>
        {seedId && (
          <button
            onClick={copySeedLink}
            className="flex items-center gap-2 rounded-full border border-border bg-secondary/40 px-3 py-1.5 text-xs transition hover:bg-secondary/70"
            title="Share this spark"
          >
            <Share2 className="h-3.5 w-3.5" /> Share spark
          </button>
        )}
      </header>

      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl px-6 py-8 space-y-6">
          {convQ.data?.messages.length === 0 && (
            <p className="text-center font-display italic text-muted-foreground">a blank page, and we're both curious</p>
          )}
          {convQ.data?.messages.map((m) => (
            <div key={m.id}>
              <MessageBubble role={m.role} content={m.content} />
              {m.role === "assistant" && (
                <FeedbackBar
                  feedback={fbByMsg.get(m.id) as any}
                  onRate={(p) => rateMut.mutate({ messageId: m.id, ...p })}
                />
              )}
            </div>
          ))}
          {sendMut.isPending && (
            <div className="fade-in-up">
              <RoleLabel role="assistant" />
              <div className="mt-1"><ThinkingDots /></div>
            </div>
          )}
        </div>
      </div>

      <form onSubmit={submit} className="border-t border-border/60 p-4">
        <div className="mx-auto flex max-w-3xl items-end gap-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(e as any); }
            }}
            placeholder="Say anything…"
            rows={1}
            className="flex-1 resize-none rounded-2xl bg-input/60 border border-border px-4 py-3 text-sm outline-none focus:border-rose max-h-40"
          />
          <button
            type="submit"
            disabled={sendMut.isPending || !input.trim()}
            className="rounded-full bg-gradient-ember p-3 text-primary-foreground transition hover:opacity-95 disabled:opacity-40"
          >
            <Send className="h-4 w-4" />
          </button>
        </div>
      </form>
    </>
  );
}

function FeedbackBar({
  feedback,
  onRate,
}: {
  feedback?: { smile: boolean; sentiment: number; note: string | null };
  onRate: (p: { smile?: boolean; sentiment?: number; note?: string }) => void;
}) {
  const smile = feedback?.smile ?? false;
  const sentiment = feedback?.sentiment ?? 0;
  return (
    <div className="mt-2 flex items-center gap-1 pl-1 text-muted-foreground">
      <button
        onClick={() => onRate({ smile: !smile })}
        title={smile ? "Unsmile" : "This made me smile"}
        className={`rounded-full p-1.5 transition hover:bg-rose/10 ${smile ? "text-rose" : "hover:text-rose"}`}
      >
        <Smile className="h-3.5 w-3.5" />
      </button>
      <button
        onClick={() => onRate({ sentiment: sentiment === 1 ? 0 : 1 })}
        title="Loved this"
        className={`rounded-full p-1.5 transition hover:bg-rose/10 ${sentiment === 1 ? "text-rose" : "hover:text-rose"}`}
      >
        <span className="text-[11px] leading-none">♥</span>
      </button>
      <button
        onClick={() => onRate({ sentiment: sentiment === 0 && !smile ? 0 : 0 })}
        title="Neutral"
        className={`rounded-full p-1.5 transition hover:bg-secondary/60 ${sentiment === 0 && !smile ? "text-foreground/60" : ""}`}
      >
        <Meh className="h-3.5 w-3.5" />
      </button>
      <button
        onClick={() => onRate({ sentiment: sentiment === -1 ? 0 : -1 })}
        title="Missed the mark"
        className={`rounded-full p-1.5 transition hover:bg-secondary/60 ${sentiment === -1 ? "text-foreground" : ""}`}
      >
        <Frown className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}


function MessageBubble({ role, content }: { role: string; content: string }) {
  if (role === "user") {
    return (
      <div className="fade-in-up flex justify-end">
        <div className="max-w-[80%] rounded-2xl rounded-br-md bg-rose/20 px-4 py-3 text-sm leading-relaxed">
          {content}
        </div>
      </div>
    );
  }
  return (
    <div className="fade-in-up">
      <RoleLabel role={role} />
      <div className="mt-1 whitespace-pre-wrap text-pretty text-[15px] leading-relaxed text-foreground/95">
        {content}
      </div>
    </div>
  );
}

function RoleLabel({ role }: { role: string }) {
  return (
    <p className="font-display italic text-xs uppercase tracking-[0.3em] text-rose/80">
      {role === "assistant" ? "Lovable" : "You"}
    </p>
  );
}

function ThinkingDots() {
  return (
    <div className="flex items-center gap-1.5 px-1">
      <span className="thinking-dot inline-block h-1.5 w-1.5 rounded-full bg-rose" />
      <span className="thinking-dot inline-block h-1.5 w-1.5 rounded-full bg-rose" />
      <span className="thinking-dot inline-block h-1.5 w-1.5 rounded-full bg-rose" />
    </div>
  );
}

/* ---------------- Memories ---------------- */

type MemoryRow = { id: string; content: string; kind: string; importance: number };

function MemoriesView() {
  const listFn = useServerFn(listMemories);
  const addFn = useServerFn(addMemory);
  const updateFn = useServerFn(updateMemory);
  const delFn = useServerFn(deleteMemory);
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["memories"], queryFn: () => listFn() });

  const [draft, setDraft] = useState("");
  const [draftImp, setDraftImp] = useState(3);

  const addMut = useMutation({
    mutationFn: () => addFn({ data: { content: draft.trim(), kind: "fact", importance: draftImp } }),
    onSuccess: () => { setDraft(""); setDraftImp(3); qc.invalidateQueries({ queryKey: ["memories"] }); toast.success("Filed away."); },
    onError: (e: Error) => toast.error(e.message),
  });
  const delMut = useMutation({
    mutationFn: (id: string) => delFn({ data: { id } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["memories"] }),
  });
  const updMut = useMutation({
    mutationFn: (p: { id: string; content?: string; importance?: number }) => updateFn({ data: p }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["memories"] }),
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="flex-1 overflow-y-auto p-8">
      <div className="mx-auto max-w-3xl">
        <h2 className="font-display text-3xl">What I remember about you</h2>
        <p className="mt-2 text-sm text-muted-foreground">Pieces I've gathered. Add, edit, or delete — your memory, your rules.</p>

        <div className="ink-card mt-6 rounded-xl p-4">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Tell me something to remember…"
            rows={2}
            className="w-full resize-none rounded-md bg-input/40 border border-border px-3 py-2 text-sm outline-none focus:border-rose"
          />
          <div className="mt-3 flex items-center justify-between gap-3">
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              Weight
              <select
                value={draftImp}
                onChange={(e) => setDraftImp(Number(e.target.value))}
                className="rounded-md bg-input/40 border border-border px-2 py-1 text-xs"
              >
                {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}/5</option>)}
              </select>
            </label>
            <button
              onClick={() => addMut.mutate()}
              disabled={draft.trim().length < 2 || addMut.isPending}
              className="rounded-full bg-gradient-ember px-4 py-1.5 text-sm text-primary-foreground transition hover:opacity-95 disabled:opacity-40"
            >
              <Plus className="inline h-3.5 w-3.5 mr-1" />Add memory
            </button>
          </div>
        </div>

        <div className="mt-6 space-y-2">
          {q.data?.length === 0 && <p className="font-display italic text-muted-foreground">Nothing yet. We're just meeting.</p>}
          {q.data?.map((m) => (
            <MemoryItem
              key={m.id}
              m={m as MemoryRow}
              onSave={(patch) => updMut.mutate({ id: m.id, ...patch })}
              onDelete={() => delMut.mutate(m.id)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function MemoryItem({ m, onSave, onDelete }: { m: MemoryRow; onSave: (p: { content?: string; importance?: number }) => void; onDelete: () => void }) {
  const [editing, setEditing] = useState(false);
  const [content, setContent] = useState(m.content);
  const [imp, setImp] = useState(m.importance);

  useEffect(() => { setContent(m.content); setImp(m.importance); }, [m.content, m.importance]);

  if (editing) {
    return (
      <div className="ink-card rounded-xl p-4 fade-in-up">
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          rows={2}
          className="w-full resize-none rounded-md bg-input/40 border border-border px-3 py-2 text-sm outline-none focus:border-rose"
        />
        <div className="mt-3 flex items-center justify-between gap-3">
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            Weight
            <select value={imp} onChange={(e) => setImp(Number(e.target.value))} className="rounded-md bg-input/40 border border-border px-2 py-1 text-xs">
              {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}/5</option>)}
            </select>
          </label>
          <div className="flex gap-1">
            <button onClick={() => setEditing(false)} className="rounded-md p-1.5 text-muted-foreground hover:bg-secondary/60" title="Cancel">
              <X className="h-4 w-4" />
            </button>
            <button
              onClick={() => { onSave({ content: content.trim(), importance: imp }); setEditing(false); }}
              disabled={content.trim().length < 2}
              className="rounded-md p-1.5 text-rose hover:bg-rose/10 disabled:opacity-40"
              title="Save"
            >
              <Check className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="ink-card group flex items-start justify-between gap-3 rounded-xl p-4 fade-in-up">
      <div className="min-w-0">
        <p className="text-sm leading-relaxed">{m.content}</p>
        <p className="mt-1 text-[10px] uppercase tracking-wider text-rose/60">
          {m.kind} · weight {m.importance}/5
        </p>
      </div>
      <div className="flex shrink-0 gap-1 opacity-0 transition group-hover:opacity-100">
        <button onClick={() => setEditing(true)} title="Edit">
          <Pencil className="h-4 w-4 text-muted-foreground hover:text-rose" />
        </button>
        <button onClick={onDelete} title="Delete">
          <Trash2 className="h-4 w-4 text-muted-foreground hover:text-destructive" />
        </button>
      </div>
    </div>
  );
}

/* ---------------- Idea Playground ---------------- */

type Flavor = "any" | "what_if" | "world_building" | "remix" | "absurd" | "ethical";
const FLAVORS: { id: Flavor; label: string }[] = [
  { id: "any", label: "Mix it up" },
  { id: "what_if", label: "What if…" },
  { id: "world_building", label: "World-build" },
  { id: "remix", label: "Mash-up" },
  { id: "absurd", label: "Absurd" },
  { id: "ethical", label: "Dilemma" },
];

function PlaygroundView({ onOpenConv }: { onOpenConv: (id: string) => void }) {
  const sparksFn = useServerFn(generateSparks);
  const playFn = useServerFn(playSpark);
  const qc = useQueryClient();
  const [flavor, setFlavor] = useState<Flavor>("any");
  const [sparks, setSparks] = useState<{ title: string; prompt: string; tag: string }[]>([]);

  const genMut = useMutation({
    mutationFn: () => sparksFn({ data: { flavor } }),
    onSuccess: (r) => setSparks(r.sparks),
    onError: (e: Error) => toast.error(e.message),
  });

  const playMut = useMutation({
    mutationFn: (s: { title: string; prompt: string }) => playFn({ data: s }),
    onSuccess: (conv) => {
      qc.invalidateQueries({ queryKey: ["conversations"] });
      onOpenConv(conv.id);
      toast.success("Let's play.");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="flex-1 overflow-y-auto p-8">
      <div className="mx-auto max-w-3xl">
        <div className="flex items-end justify-between gap-4 flex-wrap">
          <div>
            <h2 className="font-display text-3xl">Idea Playground</h2>
            <p className="mt-2 text-sm text-muted-foreground">Spark seeds — provocations to think with. Pick one and we'll yes-and from there.</p>
          </div>
          <button
            onClick={() => genMut.mutate()}
            disabled={genMut.isPending}
            className="flex items-center gap-2 rounded-full bg-gradient-ember px-5 py-2 text-sm text-primary-foreground transition hover:opacity-95 disabled:opacity-50"
          >
            <Wand2 className="h-4 w-4" />
            {genMut.isPending ? "Sparking…" : sparks.length ? "More sparks" : "Spark some ideas"}
          </button>
        </div>

        <div className="mt-5 flex flex-wrap gap-2">
          {FLAVORS.map((f) => (
            <button
              key={f.id}
              onClick={() => setFlavor(f.id)}
              className={`rounded-full px-3 py-1 text-xs uppercase tracking-wider transition ${
                flavor === f.id ? "bg-rose/25 text-foreground" : "bg-secondary/40 text-muted-foreground hover:bg-secondary/70"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>

        <div className="mt-8 grid gap-3 sm:grid-cols-2">
          {sparks.length === 0 && !genMut.isPending && (
            <p className="font-display italic text-muted-foreground sm:col-span-2">An empty stage. Spark a few to begin.</p>
          )}
          {genMut.isPending && (
            <div className="ink-card rounded-xl p-6 sm:col-span-2 flex items-center gap-3">
              <ThinkingDots /> <span className="text-sm italic text-muted-foreground">conjuring…</span>
            </div>
          )}
          {sparks.map((s, i) => (
            <button
              key={i}
              onClick={() => playMut.mutate({ title: s.title, prompt: s.prompt })}
              disabled={playMut.isPending}
              className="ink-card group rounded-xl p-5 text-left transition hover:border-rose/40 disabled:opacity-50"
            >
              <div className="flex items-center gap-2 text-[10px] uppercase tracking-wider text-rose/70">
                <Sparkles className="h-3 w-3" /> {s.tag}
              </div>
              <div className="mt-2 font-display text-lg">{s.title}</div>
              <div className="mt-1 text-sm text-foreground/80 leading-relaxed">{s.prompt}</div>
              <div className="mt-3 text-[11px] uppercase tracking-wider text-rose opacity-0 transition group-hover:opacity-100">
                Play this →
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ---------------- Wonder Reports ---------------- */

function WonderView() {
  const listFn = useServerFn(listWonderReports);
  const genFn = useServerFn(generateWonderReport);
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["wonder"], queryFn: () => listFn() });
  const gen = useMutation({
    mutationFn: () => genFn(),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["wonder"] }); toast.success("This week, summarized."); },
    onError: (e: Error) => toast.error(e.message),
  });

  const reports = q.data ?? [];
  const total = reports.length;
  const latest = reports[0];
  const span = total > 1
    ? Math.max(1, Math.round((new Date(reports[0].created_at).getTime() - new Date(reports[reports.length - 1].created_at).getTime()) / (1000 * 60 * 60 * 24)))
    : 0;

  function exportOne(r: { title: string; body: string; created_at: string }) {
    const safe = r.title.replace(/[^a-z0-9\-_ ]/gi, "").replace(/\s+/g, "_") || "wonder_report";
    const md = `# ${r.title}\n\n_${new Date(r.created_at).toLocaleString()}_\n\n${r.body}\n`;
    downloadText(`${safe}.md`, md, "text/markdown");
  }

  function exportAll() {
    if (!reports.length) return;
    const md = reports.map((r) => `# ${r.title}\n\n_${new Date(r.created_at).toLocaleString()}_\n\n${r.body}\n`).join("\n\n---\n\n");
    downloadText(`lovable_wonder_reports_${new Date().toISOString().slice(0, 10)}.md`, md, "text/markdown");
  }

  return (
    <div className="flex-1 overflow-y-auto p-8">
      <div className="mx-auto max-w-3xl">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h2 className="font-display text-3xl">Wonder Reports</h2>
            <p className="mt-2 text-sm text-muted-foreground">The strange and beautiful threads we've been pulling.</p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={exportAll}
              disabled={!reports.length}
              className="flex items-center gap-2 rounded-full border border-border bg-secondary/40 px-4 py-2 text-sm transition hover:bg-secondary/70 disabled:opacity-40"
            >
              <Download className="h-4 w-4" /> Export all
            </button>
            <button
              onClick={() => gen.mutate()} disabled={gen.isPending}
              className="rounded-full bg-gradient-ember px-5 py-2 text-sm text-primary-foreground transition hover:opacity-95 disabled:opacity-50"
            >
              {gen.isPending ? "Composing…" : "Generate this week's"}
            </button>
          </div>
        </div>

        {/* Dashboard stats */}
        <div className="mt-6 grid grid-cols-3 gap-3">
          <StatCard label="Reports" value={String(total)} />
          <StatCard label="Latest" value={latest ? new Date(latest.created_at).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "—"} />
          <StatCard label="Span" value={span ? `${span}d` : "—"} />
        </div>

        <div className="mt-8 space-y-4">
          {q.data?.length === 0 && <p className="font-display italic text-muted-foreground">No reports yet. Have a few conversations, then ask me to compose one.</p>}
          {reports.map((r) => (
            <details key={r.id} className="ink-card group rounded-2xl p-6 fade-in-up" open>
              <summary className="cursor-pointer list-none flex items-start justify-between gap-3">
                <div>
                  <h3 className="font-display text-2xl">{r.title}</h3>
                  <p className="text-[10px] uppercase tracking-wider text-rose/60">
                    {new Date(r.created_at).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}
                  </p>
                </div>
                <button
                  onClick={(e) => { e.preventDefault(); exportOne(r); }}
                  className="shrink-0 rounded-full p-2 text-muted-foreground hover:bg-rose/10 hover:text-rose"
                  title="Export as markdown"
                >
                  <Download className="h-4 w-4" />
                </button>
              </summary>
              <div className="mt-4 whitespace-pre-wrap text-sm leading-relaxed text-foreground/90">
                {r.body}
              </div>
            </details>
          ))}
        </div>
      </div>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="ink-card rounded-xl p-4">
      <div className="text-[10px] uppercase tracking-[0.2em] text-rose/70">{label}</div>
      <div className="mt-1 font-display text-2xl">{value}</div>
    </div>
  );
}

function downloadText(filename: string, content: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}
