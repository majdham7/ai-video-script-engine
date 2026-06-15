"use client";

import { useState } from "react";

// Styles available in the dropdown. Must match ALLOWED_STYLES on the server.
const STYLES = [
  "TikTok Ad",
  "Cinematic",
  "Documentary",
  "Luxury Brand",
  "Funny Meme",
  "Startup Promo",
] as const;

// Shape of a single storyboard scene returned by the API.
interface Scene {
  startTime: string;
  endTime: string;
  voiceoverText: string;
  visualPrompt: string;
  brollIdeas: string[];
  captionText: string;
  cameraMovement: string;
  editingNotes: string;
  soundEffects: string[];
}

// Shape of the full video plan returned by the API.
interface VideoPlan {
  videoTitle: string;
  overallTheme: string;
  musicStyle: string;
  colorPalette: string[];
  scenes: Scene[];
}

export default function Home() {
  // Form state
  const [script, setScript] = useState("");
  const [style, setStyle] = useState<string>(STYLES[0]);

  // Request state
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [plan, setPlan] = useState<VideoPlan | null>(null);

  // Tracks which scene's "Copy Prompt" button was just clicked, so we can
  // show a brief "Copied!" confirmation on that specific card.
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);

  async function handleGenerate() {
    if (!script.trim()) {
      setError("Please enter a script before generating a storyboard.");
      return;
    }

    setLoading(true);
    setError(null);
    setPlan(null);

    try {
      const res = await fetch("/api/generate-video-plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ script, style }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error ?? "Something went wrong.");
      }

      setPlan(data as VideoPlan);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unexpected error.");
    } finally {
      setLoading(false);
    }
  }

  // Copies a scene's visual prompt to the clipboard and briefly shows
  // a "Copied!" confirmation message on that card.
  async function handleCopyPrompt(prompt: string, index: number) {
    try {
      await navigator.clipboard.writeText(prompt);
      setCopiedIndex(index);
      setTimeout(() => setCopiedIndex(null), 1500);
    } catch {
      setError("Failed to copy prompt to clipboard.");
    }
  }

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <main className="mx-auto max-w-4xl px-4 py-10 sm:py-16">
        {/* Header */}
        <header className="mb-10 text-center">
          <h1 className="text-3xl sm:text-4xl font-bold tracking-tight">
            AI Video Script Engine
          </h1>
          <p className="mt-2 text-zinc-400">
            Turn your script into a shot-by-shot storyboard plan. No video is
            generated &mdash; this is a planning tool only.
          </p>
        </header>

        {/* Input form */}
        <section className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-6 shadow-lg">
          <div className="flex flex-col gap-4">
            <div>
              <label
                htmlFor="script"
                className="mb-2 block text-sm font-medium text-zinc-300"
              >
                Script
              </label>
              <textarea
                id="script"
                value={script}
                onChange={(e) => setScript(e.target.value)}
                placeholder="Paste or write your video script here..."
                rows={8}
                className="w-full resize-y rounded-xl border border-zinc-700 bg-zinc-950 p-3 text-sm text-zinc-100 placeholder:text-zinc-500 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              />
            </div>

            <div>
              <label
                htmlFor="style"
                className="mb-2 block text-sm font-medium text-zinc-300"
              >
                Video Style
              </label>
              <select
                id="style"
                value={style}
                onChange={(e) => setStyle(e.target.value)}
                className="w-full rounded-xl border border-zinc-700 bg-zinc-950 p-3 text-sm text-zinc-100 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              >
                {STYLES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>

            <button
              onClick={handleGenerate}
              disabled={loading}
              className="mt-2 w-full rounded-xl bg-indigo-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {loading ? "Generating storyboard..." : "Generate Storyboard"}
            </button>
          </div>
        </section>

        {/* Error state */}
        {error && (
          <div className="mt-6 rounded-xl border border-red-800 bg-red-950/50 p-4 text-sm text-red-300">
            {error}
          </div>
        )}

        {/* Loading state */}
        {loading && (
          <div className="mt-10 flex flex-col items-center gap-3 text-zinc-400">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-zinc-700 border-t-indigo-500" />
            <p className="text-sm">Building your storyboard...</p>
          </div>
        )}

        {/* Results */}
        {plan && !loading && (
          <section className="mt-10">
            {/* Overview card */}
            <div className="mb-8 rounded-2xl border border-zinc-800 bg-zinc-900/60 p-6">
              <h2 className="text-2xl font-bold">{plan.videoTitle}</h2>
              <p className="mt-2 text-zinc-400">{plan.overallTheme}</p>

              <div className="mt-4 flex flex-wrap gap-4 text-sm">
                <div>
                  <span className="text-zinc-500">Music style: </span>
                  <span className="text-zinc-200">{plan.musicStyle}</span>
                </div>
              </div>

              {plan.colorPalette?.length > 0 && (
                <div className="mt-4 flex items-center gap-2">
                  <span className="text-sm text-zinc-500">Color palette:</span>
                  <div className="flex gap-2">
                    {plan.colorPalette.map((color, i) => (
                      <div
                        key={i}
                        title={color}
                        className="h-6 w-6 rounded-full border border-zinc-700"
                        style={{ backgroundColor: color }}
                      />
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Storyboard scene cards */}
            <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
              {plan.scenes.map((scene, i) => (
                <article
                  key={i}
                  className="flex flex-col rounded-2xl border border-zinc-800 bg-zinc-900/60 p-5 shadow-md"
                >
                  <div className="mb-3 flex items-center justify-between">
                    <span className="rounded-full bg-indigo-600/20 px-3 py-1 text-xs font-semibold text-indigo-300">
                      Scene {i + 1}
                    </span>
                    <span className="text-xs text-zinc-500">
                      {scene.startTime} &ndash; {scene.endTime}
                    </span>
                  </div>

                  <dl className="space-y-3 text-sm">
                    <div>
                      <dt className="font-semibold text-zinc-300">
                        Voiceover
                      </dt>
                      <dd className="text-zinc-400">{scene.voiceoverText}</dd>
                    </div>

                    <div>
                      <dt className="font-semibold text-zinc-300">
                        Visual Prompt
                      </dt>
                      <dd className="text-zinc-400">{scene.visualPrompt}</dd>
                    </div>

                    <div>
                      <dt className="font-semibold text-zinc-300">
                        B-roll Ideas
                      </dt>
                      <dd className="text-zinc-400">
                        <ul className="list-inside list-disc">
                          {scene.brollIdeas?.map((idea, j) => (
                            <li key={j}>{idea}</li>
                          ))}
                        </ul>
                      </dd>
                    </div>

                    <div>
                      <dt className="font-semibold text-zinc-300">Caption</dt>
                      <dd className="text-zinc-400">{scene.captionText}</dd>
                    </div>

                    <div>
                      <dt className="font-semibold text-zinc-300">
                        Camera Movement
                      </dt>
                      <dd className="text-zinc-400">
                        {scene.cameraMovement}
                      </dd>
                    </div>

                    <div>
                      <dt className="font-semibold text-zinc-300">
                        Editing Notes
                      </dt>
                      <dd className="text-zinc-400">{scene.editingNotes}</dd>
                    </div>

                    <div>
                      <dt className="font-semibold text-zinc-300">
                        Sound Effects
                      </dt>
                      <dd className="text-zinc-400">
                        <ul className="list-inside list-disc">
                          {scene.soundEffects?.map((sfx, j) => (
                            <li key={j}>{sfx}</li>
                          ))}
                        </ul>
                      </dd>
                    </div>
                  </dl>

                  <button
                    onClick={() => handleCopyPrompt(scene.visualPrompt, i)}
                    className="mt-4 rounded-xl border border-zinc-700 px-3 py-2 text-xs font-semibold text-zinc-200 transition hover:bg-zinc-800"
                  >
                    {copiedIndex === i ? "Copied!" : "Copy Prompt"}
                  </button>
                </article>
              ))}
            </div>
          </section>
        )}
      </main>
    </div>
  );
}
