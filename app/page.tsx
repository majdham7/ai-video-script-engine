"use client";

import { useState, useRef } from "react";

// Styles available in the dropdown. Must match ALLOWED_STYLES on the server.
const STYLES = [
  "TikTok Ad",
  "Cinematic",
  "Documentary",
  "Luxury Brand",
  "Funny Meme",
  "Startup Promo",
] as const;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

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

interface VideoPlan {
  videoTitle: string;
  overallTheme: string;
  musicStyle: string;
  colorPalette: string[];
  scenes: Scene[];
}

// A progress event streamed from /api/generate-video.
interface ProgressEvent {
  type: "progress" | "done" | "error";
  scene?: number;
  total?: number;
  step?: string;
  message?: string;
  videoUrl?: string;
  videoTitle?: string;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function Home() {
  // --- Storyboard form state ---
  const [script, setScript] = useState("");
  const [style, setStyle] = useState<string>(STYLES[0]);

  // --- Storyboard request state ---
  const [loadingPlan, setLoadingPlan] = useState(false);
  const [planError, setPlanError] = useState<string | null>(null);
  const [plan, setPlan] = useState<VideoPlan | null>(null);

  // --- Copy-prompt state: tracks which card's button was last clicked ---
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);

  // --- Video generation state ---
  const [generatingVideo, setGeneratingVideo] = useState(false);
  const [videoError, setVideoError] = useState<string | null>(null);
  const [videoProgress, setVideoProgress] = useState<ProgressEvent | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  // ---------------------------------------------------------------------------
  // Storyboard generation
  // ---------------------------------------------------------------------------

  async function handleGeneratePlan() {
    if (!script.trim()) {
      setPlanError("Please enter a script before generating a storyboard.");
      return;
    }

    setLoadingPlan(true);
    setPlanError(null);
    setPlan(null);
    setVideoUrl(null);
    setVideoProgress(null);

    try {
      const res = await fetch("/api/generate-video-plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ script, style }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Something went wrong.");
      setPlan(data as VideoPlan);
    } catch (err) {
      setPlanError(err instanceof Error ? err.message : "Unexpected error.");
    } finally {
      setLoadingPlan(false);
    }
  }

  // ---------------------------------------------------------------------------
  // Video generation — consumes the SSE stream from /api/generate-video
  // ---------------------------------------------------------------------------

  async function handleGenerateVideo() {
    if (!plan) return;

    setGeneratingVideo(true);
    setVideoError(null);
    setVideoUrl(null);
    setVideoProgress(null);

    try {
      const res = await fetch("/api/generate-video", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          scenes: plan.scenes,
          style,
          videoTitle: plan.videoTitle,
        }),
      });

      if (!res.body) throw new Error("No response stream.");

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        // Accumulate chunks — a single read() may contain multiple SSE lines.
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");

        // Process all complete lines; keep the last (possibly incomplete) part.
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const event: ProgressEvent = JSON.parse(line.slice(6));

          if (event.type === "error") {
            throw new Error(event.message ?? "Video generation failed.");
          }

          if (event.type === "done" && event.videoUrl) {
            setVideoUrl(event.videoUrl);
            setGeneratingVideo(false);
            return;
          }

          // "progress" events — update the progress display.
          setVideoProgress(event);
        }
      }
    } catch (err) {
      setVideoError(err instanceof Error ? err.message : "Unexpected error.");
      setGeneratingVideo(false);
    }
  }

  // ---------------------------------------------------------------------------
  // Copy visual prompt to clipboard
  // ---------------------------------------------------------------------------

  async function handleCopyPrompt(prompt: string, index: number) {
    try {
      await navigator.clipboard.writeText(prompt);
      setCopiedIndex(index);
      setTimeout(() => setCopiedIndex(null), 1500);
    } catch {
      setPlanError("Failed to copy prompt to clipboard.");
    }
  }

  // ---------------------------------------------------------------------------
  // Progress bar width (0–100)
  // ---------------------------------------------------------------------------

  function progressPercent(): number {
    if (!videoProgress?.scene || !videoProgress?.total) return 0;
    const stepsPerScene = 4; // image, video, audio, merge
    const stepIndex = ["image", "video", "audio", "merge", "concat"].indexOf(
      videoProgress.step ?? ""
    );
    const completedScenes = (videoProgress.scene - 1) * stepsPerScene;
    const currentStep = Math.max(0, stepIndex);
    const total = videoProgress.total * stepsPerScene + 1; // +1 for concat
    return Math.round(((completedScenes + currentStep) / total) * 100);
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <main className="mx-auto max-w-4xl px-4 py-10 sm:py-16">

        {/* Header */}
        <header className="mb-10 text-center">
          <h1 className="text-3xl sm:text-4xl font-bold tracking-tight">
            AI Video Script Engine
          </h1>
          <p className="mt-2 text-zinc-400">
            Paste a script → get a storyboard → generate a real promo video.
          </p>
        </header>

        {/* ------------------------------------------------------------------ */}
        {/* Input form                                                          */}
        {/* ------------------------------------------------------------------ */}
        <section className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-6 shadow-lg">
          <div className="flex flex-col gap-4">
            <div>
              <label htmlFor="script" className="mb-2 block text-sm font-medium text-zinc-300">
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
              <label htmlFor="style" className="mb-2 block text-sm font-medium text-zinc-300">
                Video Style
              </label>
              <select
                id="style"
                value={style}
                onChange={(e) => setStyle(e.target.value)}
                className="w-full rounded-xl border border-zinc-700 bg-zinc-950 p-3 text-sm text-zinc-100 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              >
                {STYLES.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </div>

            <button
              onClick={handleGeneratePlan}
              disabled={loadingPlan || generatingVideo}
              className="mt-2 w-full rounded-xl bg-indigo-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {loadingPlan ? "Building storyboard..." : "Generate Storyboard"}
            </button>
          </div>
        </section>

        {/* Storyboard error */}
        {planError && (
          <div className="mt-6 rounded-xl border border-red-800 bg-red-950/50 p-4 text-sm text-red-300">
            {planError}
          </div>
        )}

        {/* Storyboard loading spinner */}
        {loadingPlan && (
          <div className="mt-10 flex flex-col items-center gap-3 text-zinc-400">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-zinc-700 border-t-indigo-500" />
            <p className="text-sm">Building your storyboard...</p>
          </div>
        )}

        {/* ------------------------------------------------------------------ */}
        {/* Storyboard results                                                  */}
        {/* ------------------------------------------------------------------ */}
        {plan && !loadingPlan && (
          <section className="mt-10">

            {/* Overview card */}
            <div className="mb-6 rounded-2xl border border-zinc-800 bg-zinc-900/60 p-6">
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

              {/* Generate Video button */}
              <button
                onClick={handleGenerateVideo}
                disabled={generatingVideo}
                className="mt-6 w-full rounded-xl bg-violet-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-violet-500 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {generatingVideo ? "Generating video..." : "Generate Promo Video"}
              </button>
              <p className="mt-2 text-center text-xs text-zinc-500">
                Uses DALL-E → Runway → ElevenLabs → FFmpeg. Takes ~2–5 min per scene.
              </p>
            </div>

            {/* ---------------------------------------------------------------- */}
            {/* Video generation progress                                        */}
            {/* ---------------------------------------------------------------- */}
            {generatingVideo && videoProgress && (
              <div className="mb-6 rounded-2xl border border-violet-800 bg-violet-950/30 p-6">
                <p className="mb-3 text-sm font-semibold text-violet-300">
                  {videoProgress.message}
                </p>
                <div className="h-2 w-full overflow-hidden rounded-full bg-zinc-800">
                  <div
                    className="h-full rounded-full bg-violet-500 transition-all duration-500"
                    style={{ width: `${progressPercent()}%` }}
                  />
                </div>
                <p className="mt-2 text-right text-xs text-zinc-500">
                  {progressPercent()}%
                </p>
              </div>
            )}

            {/* Video generation error */}
            {videoError && (
              <div className="mb-6 rounded-xl border border-red-800 bg-red-950/50 p-4 text-sm text-red-300">
                {videoError}
              </div>
            )}

            {/* ---------------------------------------------------------------- */}
            {/* Final video player                                               */}
            {/* ---------------------------------------------------------------- */}
            {videoUrl && (
              <div className="mb-8 rounded-2xl border border-emerald-800 bg-emerald-950/20 p-6">
                <h3 className="mb-4 text-lg font-bold text-emerald-300">
                  Your promo video is ready!
                </h3>
                <video
                  ref={videoRef}
                  src={videoUrl}
                  controls
                  className="w-full rounded-xl border border-zinc-700"
                />
                <a
                  href={videoUrl}
                  download={`${plan.videoTitle}.mp4`}
                  className="mt-4 flex items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-emerald-500"
                >
                  Download MP4
                </a>
              </div>
            )}

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
                      <dt className="font-semibold text-zinc-300">Voiceover</dt>
                      <dd className="text-zinc-400">{scene.voiceoverText}</dd>
                    </div>
                    <div>
                      <dt className="font-semibold text-zinc-300">Visual Prompt</dt>
                      <dd className="text-zinc-400">{scene.visualPrompt}</dd>
                    </div>
                    <div>
                      <dt className="font-semibold text-zinc-300">B-roll Ideas</dt>
                      <dd className="text-zinc-400">
                        <ul className="list-inside list-disc">
                          {scene.brollIdeas?.map((idea, j) => <li key={j}>{idea}</li>)}
                        </ul>
                      </dd>
                    </div>
                    <div>
                      <dt className="font-semibold text-zinc-300">Caption</dt>
                      <dd className="text-zinc-400">{scene.captionText}</dd>
                    </div>
                    <div>
                      <dt className="font-semibold text-zinc-300">Camera Movement</dt>
                      <dd className="text-zinc-400">{scene.cameraMovement}</dd>
                    </div>
                    <div>
                      <dt className="font-semibold text-zinc-300">Editing Notes</dt>
                      <dd className="text-zinc-400">{scene.editingNotes}</dd>
                    </div>
                    <div>
                      <dt className="font-semibold text-zinc-300">Sound Effects</dt>
                      <dd className="text-zinc-400">
                        <ul className="list-inside list-disc">
                          {scene.soundEffects?.map((sfx, j) => <li key={j}>{sfx}</li>)}
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
