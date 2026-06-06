import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation } from "@tanstack/react-query";
import { getSharedSeed, playSeed } from "@/lib/playground.functions";
import { supabase } from "@/integrations/supabase/client";
import { Sparkles, Copy, ArrowRight } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/spark/$slug")({
  component: SharedSparkPage,
  head: ({ params }) => ({
    meta: [
      { title: `A spark — Lovable` },
      { name: "description", content: `A shared spark seed: ${params.slug}` },
      { property: "og:title", content: "A spark from Lovable" },
      { property: "og:description", content: "A provocation to think with." },
    ],
  }),
});

function SharedSparkPage() {
  const { slug } = Route.useParams();
  const navigate = useNavigate();
  const getFn = useServerFn(getSharedSeed);
  const playFn = useServerFn(playSeed);
  const [authed, setAuthed] = useState<boolean | null>(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setAuthed(!!data.user));
  }, []);

  const seedQ = useQuery({
    queryKey: ["shared-seed", slug],
    queryFn: () => getFn({ data: { slug } }),
    retry: false,
  });

  const playMut = useMutation({
    mutationFn: (id: string) => playFn({ data: { seedId: id } }),
    onSuccess: (conv) => {
      // Pass the conv id via search so app can open it; using simple navigation + localStorage for now
      try { localStorage.setItem("lovable.openConv", conv.id); } catch {}
      navigate({ to: "/app" });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  function copyLink() {
    navigator.clipboard.writeText(window.location.href);
    toast.success("Link copied.");
  }

  if (seedQ.isLoading) {
    return <div className="flex min-h-screen items-center justify-center"><p className="font-display italic text-rose/70">finding the spark…</p></div>;
  }
  if (seedQ.isError || !seedQ.data) {
    return (
      <div className="flex min-h-screen items-center justify-center p-6 text-center">
        <div>
          <p className="font-display text-2xl">This spark has gone cold.</p>
          <p className="mt-2 text-sm text-muted-foreground">The link may be wrong, or the seed was removed.</p>
          <Link to="/" className="mt-6 inline-block rounded-full bg-gradient-ember px-5 py-2 text-sm text-primary-foreground">Back home</Link>
        </div>
      </div>
    );
  }

  const seed = seedQ.data;

  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-background">
      <div className="w-full max-w-2xl">
        <p className="font-display italic text-xs uppercase tracking-[0.3em] text-rose/80">— a spark from Lovable —</p>
        <div className="mt-4 ink-card rounded-2xl p-8 fade-in-up">
          <div className="flex items-center gap-2 text-[11px] uppercase tracking-wider text-rose/70">
            <Sparkles className="h-3 w-3" /> {seed.tag || "spark"}
          </div>
          <h1 className="mt-2 font-display text-3xl">{seed.title}</h1>
          <p className="mt-4 text-pretty leading-relaxed text-foreground/90">{seed.prompt}</p>
        </div>

        <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
          <button
            onClick={copyLink}
            className="flex items-center gap-2 rounded-full border border-border bg-secondary/40 px-4 py-2 text-sm transition hover:bg-secondary/70"
          >
            <Copy className="h-4 w-4" /> Copy link
          </button>
          {authed === false ? (
            <Link to="/auth" className="flex items-center gap-2 rounded-full bg-gradient-ember px-5 py-2 text-sm text-primary-foreground hover:opacity-95">
              Sign in to play <ArrowRight className="h-4 w-4" />
            </Link>
          ) : (
            <button
              onClick={() => playMut.mutate(seed.id)}
              disabled={playMut.isPending || authed === null}
              className="flex items-center gap-2 rounded-full bg-gradient-ember px-5 py-2 text-sm text-primary-foreground transition hover:opacity-95 disabled:opacity-50"
            >
              {playMut.isPending ? "Opening…" : "Play this spark"} <ArrowRight className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
