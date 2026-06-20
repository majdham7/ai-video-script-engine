"use client";

import { useState, useRef } from "react";

const STYLES = ["TikTok Ad", "Cinematic", "Documentary", "Luxury Brand", "Funny Meme", "Startup Promo"] as const;
const LENGTHS = ["30s", "60s", "90s", "2min"] as const;

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
  // Form
  const [script, setScript] = useState("");
  const [style, setStyle] = useState<string>(STYLES[0]);
  const [length, setLength] = useState<string>(LENGTHS[1]);

  // Storyboard
  const [loadingPlan, setLoadingPlan] = useState(false);
  const [planError, setPlanError] = useState<string | null>(null);
  const [plan, setPlan] = useState<VideoPlan | null>(null);

  // Editable plan state (user can tweak before generating video)
  const [editedScenes, setEditedScenes] = useState<Scene[]>([]);
  const [editedPalette, setEditedPalette] = useState<string[]>([]);

  // Copy prompt
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);

  // Video generation
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
        body: JSON.stringify({ script, style, length }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Something went wrong.");
      const p = data as VideoPlan;
      setPlan(p);
      setEditedScenes(p.scenes.map((s) => ({ ...s })));
      // Ensure 5 palette colours; pad with a neutral if the model returned fewer.
      const palette = [...(p.colorPalette ?? [])];
      while (palette.length < 5) palette.push("#1a1a2e");
      setEditedPalette(palette.slice(0, 5));
    } catch (err) {
      setPlanError(err instanceof Error ? err.message : "Unexpected error.");
    } finally {
      setLoadingPlan(false);
    }
  }

  // ---------------------------------------------------------------------------
  // Scene field helpers
  // ---------------------------------------------------------------------------

  function updateSceneField<K extends keyof Scene>(index: number, field: K, value: Scene[K]) {
    setEditedScenes((prev) => prev.map((s, i) => (i === index ? { ...s, [field]: value } : s)));
  }

  function updateSceneList(index: number, field: "brollIdeas" | "soundEffects", raw: string) {
    updateSceneField(index, field, raw.split("\n").filter(Boolean));
  }

  // ---------------------------------------------------------------------------
  // Video generation
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
        body: JSON.stringify({ scenes: editedScenes, style, videoTitle: plan.videoTitle }),
      });
      if (!res.body) throw new Error("No response stream.");

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const event: ProgressEvent = JSON.parse(line.slice(6));
          if (event.type === "error") throw new Error(event.message ?? "Video generation failed.");
          if (event.type === "done" && event.videoUrl) {
            setVideoUrl(event.videoUrl);
            setGeneratingVideo(false);
            return;
          }
          setVideoProgress(event);
        }
      }
    } catch (err) {
      setVideoError(err instanceof Error ? err.message : "Unexpected error.");
      setGeneratingVideo(false);
    }
  }

  async function handleCopyPrompt(prompt: string, index: number) {
    try {
      await navigator.clipboard.writeText(prompt);
      setCopiedIndex(index);
      setTimeout(() => setCopiedIndex(null), 1500);
    } catch {
      setPlanError("Failed to copy to clipboard.");
    }
  }

  function progressPercent(): number {
    if (!videoProgress?.scene || !videoProgress?.total) return 0;
    const stepsPerScene = 4;
    const stepIndex = ["video", "audio", "merge", "concat"].indexOf(videoProgress.step ?? "");
    const completedScenes = (videoProgress.scene - 1) * stepsPerScene;
    const total = videoProgress.total * stepsPerScene + 1;
    return Math.round(((completedScenes + Math.max(0, stepIndex)) / total) * 100);
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <main className="mx-auto max-w-4xl px-4 py-10 sm:py-16">

        {/* Header */}
        <header className="mb-10 text-center">
          <h1 className="text-3xl sm:text-4xl font-bold tracking-tight">AI Video Script Engine</h1>
          <p className="mt-2 text-zinc-400">Paste a script → get a storyboard → generate a real promo video.</p>
        </header>

        {/* ------------------------------------------------------------------ */}
        {/* Input form                                                          */}
        {/* ------------------------------------------------------------------ */}
        <section className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-6 shadow-lg">
          <div className="flex flex-col gap-4">
            <div>
              <label htmlFor="script" className="mb-2 block text-sm font-medium text-zinc-300">Script</label>
              <textarea
                id="script"
                value={script}
                onChange={(e) => setScript(e.target.value)}
                placeholder="Paste or write your video script here..."
                rows={8}
                className="w-full resize-y rounded-xl border border-zinc-700 bg-zinc-950 p-3 text-sm text-zinc-100 placeholder:text-zinc-500 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label htmlFor="style" className="mb-2 block text-sm font-medium text-zinc-300">Video Style</label>
                <select
                  id="style"
                  value={style}
                  onChange={(e) => setStyle(e.target.value)}
                  className="w-full rounded-xl border border-zinc-700 bg-zinc-950 p-3 text-sm text-zinc-100 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                >
                  {STYLES.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>

              <div>
                <label htmlFor="length" className="mb-2 block text-sm font-medium text-zinc-300">Video Length</label>
                <select
                  id="length"
                  value={length}
                  onChange={(e) => setLength(e.target.value)}
                  className="w-full rounded-xl border border-zinc-700 bg-zinc-950 p-3 text-sm text-zinc-100 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                >
                  {LENGTHS.map((l) => <option key={l} value={l}>{l}</option>)}
                </select>
              </div>
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

        {planError && (
          <div className="mt-6 rounded-xl border border-red-800 bg-red-950/50 p-4 text-sm text-red-300">{planError}</div>
        )}

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

            {/* Overview + editable palette */}
            <div className="mb-6 rounded-2xl border border-zinc-800 bg-zinc-900/60 p-6">
              <h2 className="text-2xl font-bold">{plan.videoTitle}</h2>
              <p className="mt-2 text-zinc-400">{plan.overallTheme}</p>
              <div className="mt-3 text-sm">
                <span className="text-zinc-500">Music style: </span>
                <span className="text-zinc-200">{plan.musicStyle}</span>
              </div>

              {/* Editable color palette */}
              <div className="mt-4">
                <p className="mb-2 text-sm text-zinc-500">Color palette — click any swatch to change:</p>
                <div className="flex gap-3">
                  {editedPalette.map((color, i) => (
                    <label key={i} className="group relative cursor-pointer" title={color}>
                      <div
                        className="h-9 w-9 rounded-full border-2 border-zinc-600 transition group-hover:border-white"
                        style={{ backgroundColor: color }}
                      />
                      <input
                        type="color"
                        value={color.startsWith("#") ? color : "#1a1a2e"}
                        onChange={(e) =>
                          setEditedPalette((prev) => prev.map((c, ci) => (ci === i ? e.target.value : c)))
                        }
                        className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
                      />
                    </label>
                  ))}
                </div>
                <div className="mt-2 flex gap-3">
                  {editedPalette.map((color, i) => (
                    <span key={i} className="text-xs text-zinc-500">{color}</span>
                  ))}
                </div>
              </div>

              {/* Generate Video button */}
              <button
                onClick={handleGenerateVideo}
                disabled={generatingVideo}
                className="mt-6 w-full rounded-xl bg-violet-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-violet-500 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {generatingVideo ? "Generating video..." : "Generate Promo Video"}
              </button>
              <p className="mt-2 text-center text-xs text-zinc-500">
                Edit any scene below before generating. Uses Kling AI + ElevenLabs + FFmpeg.
              </p>
            </div>

            {/* Video progress */}
            {generatingVideo && videoProgress && (
              <div className="mb-6 rounded-2xl border border-violet-800 bg-violet-950/30 p-6">
                <p className="mb-3 text-sm font-semibold text-violet-300">{videoProgress.message}</p>
                <div className="h-2 w-full overflow-hidden rounded-full bg-zinc-800">
                  <div
                    className="h-full rounded-full bg-violet-500 transition-all duration-500"
                    style={{ width: `${progressPercent()}%` }}
                  />
                </div>
                <p className="mt-2 text-right text-xs text-zinc-500">{progressPercent()}%</p>
              </div>
            )}

            {videoError && (
              <div className="mb-6 rounded-xl border border-red-800 bg-red-950/50 p-4 text-sm text-red-300">{videoError}</div>
            )}

            {/* Final video player */}
            {videoUrl && (
              <div className="mb-8 rounded-2xl border border-emerald-800 bg-emerald-950/20 p-6">
                <h3 className="mb-4 text-lg font-bold text-emerald-300">Your promo video is ready!</h3>
                <video ref={videoRef} src={videoUrl} controls className="w-full rounded-xl border border-zinc-700" />
                <a
                  href={videoUrl}
                  download={`${plan.videoTitle}.mp4`}
                  className="mt-4 flex items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-emerald-500"
                >
                  Download MP4
                </a>
              </div>
            )}

            {/* ---------------------------------------------------------------- */}
            {/* Editable scene cards                                             */}
            {/* ---------------------------------------------------------------- */}
            <h3 className="mb-4 text-lg font-semibold text-zinc-200">
              Scenes <span className="text-sm font-normal text-zinc-500">— edit any field before generating</span>
            </h3>
            <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
              {editedScenes.map((scene, i) => (
                <article key={i} className="flex flex-col rounded-2xl border border-zinc-800 bg-zinc-900/60 p-5 shadow-md">
                  <div className="mb-4 flex items-center justify-between">
                    <span className="rounded-full bg-indigo-600/20 px-3 py-1 text-xs font-semibold text-indigo-300">
                      Scene {i + 1}
                    </span>
                    <div className="flex gap-2 text-xs text-zinc-500">
                      <input
                        value={scene.startTime}
                        onChange={(e) => updateSceneField(i, "startTime", e.target.value)}
                        className="w-12 rounded bg-zinc-800 px-1 py-0.5 text-center text-zinc-300 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                      />
                      <span>–</span>
                      <input
                        value={scene.endTime}
                        onChange={(e) => updateSceneField(i, "endTime", e.target.value)}
                        className="w-12 rounded bg-zinc-800 px-1 py-0.5 text-center text-zinc-300 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                      />
                    </div>
                  </div>

                  <div className="flex flex-col gap-3 text-sm">
                    <div>
                      <label className="mb-1 block font-semibold text-zinc-300">Voiceover</label>
                      <textarea
                        value={scene.voiceoverText}
                        onChange={(e) => updateSceneField(i, "voiceoverText", e.target.value)}
                        rows={3}
                        className="w-full resize-y rounded-lg border border-zinc-700 bg-zinc-950 p-2 text-zinc-300 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                      />
                    </div>

                    <div>
                      <label className="mb-1 block font-semibold text-zinc-300">Visual Prompt</label>
                      <textarea
                        value={scene.visualPrompt}
                        onChange={(e) => updateSceneField(i, "visualPrompt", e.target.value)}
                        rows={3}
                        className="w-full resize-y rounded-lg border border-zinc-700 bg-zinc-950 p-2 text-zinc-300 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                      />
                    </div>

                    <div>
                      <label className="mb-1 block font-semibold text-zinc-300">Caption</label>
                      <input
                        value={scene.captionText}
                        onChange={(e) => updateSceneField(i, "captionText", e.target.value)}
                        className="w-full rounded-lg border border-zinc-700 bg-zinc-950 p-2 text-zinc-300 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                      />
                    </div>

                    <div>
                      <label className="mb-1 block font-semibold text-zinc-300">Camera Movement</label>
                      <input
                        value={scene.cameraMovement}
                        onChange={(e) => updateSceneField(i, "cameraMovement", e.target.value)}
                        className="w-full rounded-lg border border-zinc-700 bg-zinc-950 p-2 text-zinc-300 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                      />
                    </div>

                    <div>
                      <label className="mb-1 block font-semibold text-zinc-300">Editing Notes</label>
                      <input
                        value={scene.editingNotes}
                        onChange={(e) => updateSceneField(i, "editingNotes", e.target.value)}
                        className="w-full rounded-lg border border-zinc-700 bg-zinc-950 p-2 text-zinc-300 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                      />
                    </div>

                    <div>
                      <label className="mb-1 block font-semibold text-zinc-300">
                        B-roll Ideas <span className="font-normal text-zinc-500">(one per line)</span>
                      </label>
                      <textarea
                        value={scene.brollIdeas.join("\n")}
                        onChange={(e) => updateSceneList(i, "brollIdeas", e.target.value)}
                        rows={3}
                        className="w-full resize-y rounded-lg border border-zinc-700 bg-zinc-950 p-2 text-zinc-300 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                      />
                    </div>

                    <div>
                      <label className="mb-1 block font-semibold text-zinc-300">
                        Sound Effects <span className="font-normal text-zinc-500">(one per line)</span>
                      </label>
                      <textarea
                        value={scene.soundEffects.join("\n")}
                        onChange={(e) => updateSceneList(i, "soundEffects", e.target.value)}
                        rows={2}
                        className="w-full resize-y rounded-lg border border-zinc-700 bg-zinc-950 p-2 text-zinc-300 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                      />
                    </div>
                  </div>

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
