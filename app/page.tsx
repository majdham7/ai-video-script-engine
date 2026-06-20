"use client";

import { useState, useRef } from "react";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STYLES = ["TikTok Ad", "Cinematic", "Documentary", "Luxury Brand", "Funny Meme", "Startup Promo"] as const;
const LENGTHS = ["30s", "60s", "90s", "2min"] as const;

const PLATFORMS = ["Instagram Post", "Instagram Story", "TikTok Cover", "Twitter / X", "LinkedIn", "YouTube Thumbnail", "Facebook Post"] as const;
const IMAGE_STYLES = ["Photorealistic", "Cinematic", "Illustration", "3D Render", "Minimalist", "Neon / Cyberpunk", "Vintage / Retro", "Bold & Graphic"] as const;
const IMAGE_TONES = ["Professional", "Fun & Playful", "Luxury", "Bold & Energetic", "Calm & Serene", "Dark & Dramatic"] as const;

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

interface GeneratedImage {
  url: string | null;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function Home() {
  const [activeTab, setActiveTab] = useState<"video" | "creative">("video");

  // --- Video Engine state ---
  const [script, setScript] = useState("");
  const [style, setStyle] = useState<string>(STYLES[0]);
  const [length, setLength] = useState<string>(LENGTHS[1]);
  const [loadingPlan, setLoadingPlan] = useState(false);
  const [planError, setPlanError] = useState<string | null>(null);
  const [plan, setPlan] = useState<VideoPlan | null>(null);
  const [editedScenes, setEditedScenes] = useState<Scene[]>([]);
  const [editedPalette, setEditedPalette] = useState<string[]>([]);
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);
  const [generatingVideo, setGeneratingVideo] = useState(false);
  const [videoError, setVideoError] = useState<string | null>(null);
  const [videoProgress, setVideoProgress] = useState<ProgressEvent | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  // --- Creative Engine state ---
  const [imagePrompt, setImagePrompt] = useState("");
  const [imagePlatform, setImagePlatform] = useState<string>(PLATFORMS[0]);
  const [imageStyle, setImageStyle] = useState<string>(IMAGE_STYLES[0]);
  const [imageTone, setImageTone] = useState<string>(IMAGE_TONES[0]);
  const [imageCount, setImageCount] = useState(2);
  const [loadingImages, setLoadingImages] = useState(false);
  const [imageError, setImageError] = useState<string | null>(null);
  const [generatedImages, setGeneratedImages] = useState<GeneratedImage[]>([]);

  // ---------------------------------------------------------------------------
  // Video Engine handlers
  // ---------------------------------------------------------------------------

  async function handleGeneratePlan() {
    if (!script.trim()) { setPlanError("Please enter a script."); return; }
    setLoadingPlan(true); setPlanError(null); setPlan(null); setVideoUrl(null); setVideoProgress(null);
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
      const palette = [...(p.colorPalette ?? [])];
      while (palette.length < 5) palette.push("#1a1a2e");
      setEditedPalette(palette.slice(0, 5));
    } catch (err) {
      setPlanError(err instanceof Error ? err.message : "Unexpected error.");
    } finally {
      setLoadingPlan(false);
    }
  }

  function updateSceneField<K extends keyof Scene>(index: number, field: K, value: Scene[K]) {
    setEditedScenes((prev) => prev.map((s, i) => (i === index ? { ...s, [field]: value } : s)));
  }

  function updateSceneList(index: number, field: "brollIdeas" | "soundEffects", raw: string) {
    updateSceneField(index, field, raw.split("\n").filter(Boolean));
  }

  async function handleGenerateVideo() {
    if (!plan) return;
    setGeneratingVideo(true); setVideoError(null); setVideoUrl(null); setVideoProgress(null);
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
          if (event.type === "error") throw new Error(event.message ?? "Failed.");
          if (event.type === "done" && event.videoUrl) { setVideoUrl(event.videoUrl); setGeneratingVideo(false); return; }
          setVideoProgress(event);
        }
      }
    } catch (err) {
      setVideoError(err instanceof Error ? err.message : "Unexpected error.");
      setGeneratingVideo(false);
    }
  }

  async function handleCopyPrompt(prompt: string, index: number) {
    try { await navigator.clipboard.writeText(prompt); setCopiedIndex(index); setTimeout(() => setCopiedIndex(null), 1500); }
    catch { setPlanError("Failed to copy."); }
  }

  function progressPercent() {
    if (!videoProgress?.scene || !videoProgress?.total) return 0;
    const stepsPerScene = 4;
    const stepIndex = ["video", "audio", "merge", "concat"].indexOf(videoProgress.step ?? "");
    const completedScenes = (videoProgress.scene - 1) * stepsPerScene;
    const total = videoProgress.total * stepsPerScene + 1;
    return Math.round(((completedScenes + Math.max(0, stepIndex)) / total) * 100);
  }

  // ---------------------------------------------------------------------------
  // Creative Engine handlers
  // ---------------------------------------------------------------------------

  async function handleGenerateImages() {
    if (!imagePrompt.trim()) { setImageError("Please enter a prompt."); return; }
    setLoadingImages(true); setImageError(null); setGeneratedImages([]);
    try {
      const res = await fetch("/api/generate-image", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: imagePrompt, platform: imagePlatform, style: imageStyle, tone: imageTone, count: imageCount }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Image generation failed.");
      setGeneratedImages(data.images as GeneratedImage[]);
    } catch (err) {
      setImageError(err instanceof Error ? err.message : "Unexpected error.");
    } finally {
      setLoadingImages(false);
    }
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <main className="mx-auto max-w-4xl px-4 py-10 sm:py-16">

        {/* Header */}
        <header className="mb-8 text-center">
          <h1 className="text-3xl sm:text-4xl font-bold tracking-tight">AI Creative Studio</h1>
          <p className="mt-2 text-zinc-400">Turn ideas into videos and social media content — powered by AI.</p>
        </header>

        {/* Tab bar */}
        <div className="mb-8 flex gap-1 rounded-xl border border-zinc-800 bg-zinc-900 p-1">
          {(["video", "creative"] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`flex-1 rounded-lg py-2.5 text-sm font-semibold transition ${
                activeTab === tab
                  ? "bg-indigo-600 text-white shadow"
                  : "text-zinc-400 hover:text-zinc-200"
              }`}
            >
              {tab === "video" ? "🎬  Video Script Engine" : "🎨  Creative Image Engine"}
            </button>
          ))}
        </div>

        {/* ================================================================== */}
        {/* VIDEO ENGINE TAB                                                    */}
        {/* ================================================================== */}
        {activeTab === "video" && (
          <>
            <section className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-6 shadow-lg">
              <div className="flex flex-col gap-4">
                <div>
                  <label htmlFor="script" className="mb-2 block text-sm font-medium text-zinc-300">Script</label>
                  <textarea
                    id="script" value={script} onChange={(e) => setScript(e.target.value)}
                    placeholder="Paste or write your video script here..." rows={8}
                    className="w-full resize-y rounded-xl border border-zinc-700 bg-zinc-950 p-3 text-sm text-zinc-100 placeholder:text-zinc-500 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label htmlFor="style" className="mb-2 block text-sm font-medium text-zinc-300">Video Style</label>
                    <select id="style" value={style} onChange={(e) => setStyle(e.target.value)}
                      className="w-full rounded-xl border border-zinc-700 bg-zinc-950 p-3 text-sm text-zinc-100 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500">
                      {STYLES.map((s) => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </div>
                  <div>
                    <label htmlFor="length" className="mb-2 block text-sm font-medium text-zinc-300">Video Length</label>
                    <select id="length" value={length} onChange={(e) => setLength(e.target.value)}
                      className="w-full rounded-xl border border-zinc-700 bg-zinc-950 p-3 text-sm text-zinc-100 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500">
                      {LENGTHS.map((l) => <option key={l} value={l}>{l}</option>)}
                    </select>
                  </div>
                </div>
                <button onClick={handleGeneratePlan} disabled={loadingPlan || generatingVideo}
                  className="mt-2 w-full rounded-xl bg-indigo-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-60">
                  {loadingPlan ? "Building storyboard..." : "Generate Storyboard"}
                </button>
              </div>
            </section>

            {planError && <div className="mt-6 rounded-xl border border-red-800 bg-red-950/50 p-4 text-sm text-red-300">{planError}</div>}
            {loadingPlan && (
              <div className="mt-10 flex flex-col items-center gap-3 text-zinc-400">
                <div className="h-8 w-8 animate-spin rounded-full border-2 border-zinc-700 border-t-indigo-500" />
                <p className="text-sm">Building your storyboard...</p>
              </div>
            )}

            {plan && !loadingPlan && (
              <section className="mt-10">
                <div className="mb-6 rounded-2xl border border-zinc-800 bg-zinc-900/60 p-6">
                  <h2 className="text-2xl font-bold">{plan.videoTitle}</h2>
                  <p className="mt-2 text-zinc-400">{plan.overallTheme}</p>
                  <div className="mt-3 text-sm"><span className="text-zinc-500">Music: </span><span className="text-zinc-200">{plan.musicStyle}</span></div>

                  {/* Editable palette */}
                  <div className="mt-4">
                    <p className="mb-2 text-sm text-zinc-500">Color palette — click to change:</p>
                    <div className="flex gap-3">
                      {editedPalette.map((color, i) => (
                        <label key={i} className="group relative cursor-pointer" title={color}>
                          <div className="h-9 w-9 rounded-full border-2 border-zinc-600 transition group-hover:border-white" style={{ backgroundColor: color }} />
                          <input type="color" value={color.startsWith("#") ? color : "#1a1a2e"}
                            onChange={(e) => setEditedPalette((prev) => prev.map((c, ci) => (ci === i ? e.target.value : c)))}
                            className="absolute inset-0 h-full w-full cursor-pointer opacity-0" />
                        </label>
                      ))}
                    </div>
                    <div className="mt-2 flex gap-3">{editedPalette.map((c, i) => <span key={i} className="text-xs text-zinc-500">{c}</span>)}</div>
                  </div>

                  <button onClick={handleGenerateVideo} disabled={generatingVideo}
                    className="mt-6 w-full rounded-xl bg-violet-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-violet-500 disabled:cursor-not-allowed disabled:opacity-60">
                    {generatingVideo ? "Generating video..." : "Generate Promo Video"}
                  </button>
                  <p className="mt-2 text-center text-xs text-zinc-500">Edit scenes below before generating · Kling AI + ElevenLabs + FFmpeg</p>
                </div>

                {generatingVideo && videoProgress && (
                  <div className="mb-6 rounded-2xl border border-violet-800 bg-violet-950/30 p-6">
                    <p className="mb-3 text-sm font-semibold text-violet-300">{videoProgress.message}</p>
                    <div className="h-2 w-full overflow-hidden rounded-full bg-zinc-800">
                      <div className="h-full rounded-full bg-violet-500 transition-all duration-500" style={{ width: `${progressPercent()}%` }} />
                    </div>
                    <p className="mt-2 text-right text-xs text-zinc-500">{progressPercent()}%</p>
                  </div>
                )}

                {videoError && <div className="mb-6 rounded-xl border border-red-800 bg-red-950/50 p-4 text-sm text-red-300">{videoError}</div>}

                {videoUrl && (
                  <div className="mb-8 rounded-2xl border border-emerald-800 bg-emerald-950/20 p-6">
                    <h3 className="mb-4 text-lg font-bold text-emerald-300">Your promo video is ready!</h3>
                    <video ref={videoRef} src={videoUrl} controls className="w-full rounded-xl border border-zinc-700" />
                    <a href={videoUrl} download={`${plan.videoTitle}.mp4`}
                      className="mt-4 flex items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-emerald-500">
                      Download MP4
                    </a>
                  </div>
                )}

                <h3 className="mb-4 text-lg font-semibold text-zinc-200">Scenes <span className="text-sm font-normal text-zinc-500">— edit any field before generating</span></h3>
                <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
                  {editedScenes.map((scene, i) => (
                    <article key={i} className="flex flex-col rounded-2xl border border-zinc-800 bg-zinc-900/60 p-5 shadow-md">
                      <div className="mb-4 flex items-center justify-between">
                        <span className="rounded-full bg-indigo-600/20 px-3 py-1 text-xs font-semibold text-indigo-300">Scene {i + 1}</span>
                        <div className="flex gap-2 text-xs text-zinc-500">
                          <input value={scene.startTime} onChange={(e) => updateSceneField(i, "startTime", e.target.value)}
                            className="w-12 rounded bg-zinc-800 px-1 py-0.5 text-center text-zinc-300 focus:outline-none focus:ring-1 focus:ring-indigo-500" />
                          <span>–</span>
                          <input value={scene.endTime} onChange={(e) => updateSceneField(i, "endTime", e.target.value)}
                            className="w-12 rounded bg-zinc-800 px-1 py-0.5 text-center text-zinc-300 focus:outline-none focus:ring-1 focus:ring-indigo-500" />
                        </div>
                      </div>
                      <div className="flex flex-col gap-3 text-sm">
                        {[
                          { label: "Voiceover", field: "voiceoverText" as keyof Scene, rows: 3 },
                          { label: "Visual Prompt", field: "visualPrompt" as keyof Scene, rows: 3 },
                        ].map(({ label, field, rows }) => (
                          <div key={field}>
                            <label className="mb-1 block font-semibold text-zinc-300">{label}</label>
                            <textarea value={scene[field] as string} rows={rows}
                              onChange={(e) => updateSceneField(i, field, e.target.value)}
                              className="w-full resize-y rounded-lg border border-zinc-700 bg-zinc-950 p-2 text-zinc-300 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500" />
                          </div>
                        ))}
                        {[
                          { label: "Caption", field: "captionText" as keyof Scene },
                          { label: "Camera Movement", field: "cameraMovement" as keyof Scene },
                          { label: "Editing Notes", field: "editingNotes" as keyof Scene },
                        ].map(({ label, field }) => (
                          <div key={field}>
                            <label className="mb-1 block font-semibold text-zinc-300">{label}</label>
                            <input value={scene[field] as string}
                              onChange={(e) => updateSceneField(i, field, e.target.value)}
                              className="w-full rounded-lg border border-zinc-700 bg-zinc-950 p-2 text-zinc-300 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500" />
                          </div>
                        ))}
                        {[
                          { label: "B-roll Ideas", field: "brollIdeas" as const },
                          { label: "Sound Effects", field: "soundEffects" as const },
                        ].map(({ label, field }) => (
                          <div key={field}>
                            <label className="mb-1 block font-semibold text-zinc-300">{label} <span className="font-normal text-zinc-500">(one per line)</span></label>
                            <textarea value={scene[field].join("\n")} rows={2}
                              onChange={(e) => updateSceneList(i, field, e.target.value)}
                              className="w-full resize-y rounded-lg border border-zinc-700 bg-zinc-950 p-2 text-zinc-300 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500" />
                          </div>
                        ))}
                      </div>
                      <button onClick={() => handleCopyPrompt(scene.visualPrompt, i)}
                        className="mt-4 rounded-xl border border-zinc-700 px-3 py-2 text-xs font-semibold text-zinc-200 transition hover:bg-zinc-800">
                        {copiedIndex === i ? "Copied!" : "Copy Prompt"}
                      </button>
                    </article>
                  ))}
                </div>
              </section>
            )}
          </>
        )}

        {/* ================================================================== */}
        {/* CREATIVE ENGINE TAB                                                 */}
        {/* ================================================================== */}
        {activeTab === "creative" && (
          <>
            <section className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-6 shadow-lg">
              <div className="flex flex-col gap-4">
                <div>
                  <label htmlFor="imagePrompt" className="mb-2 block text-sm font-medium text-zinc-300">What do you want to create?</label>
                  <textarea
                    id="imagePrompt" value={imagePrompt} onChange={(e) => setImagePrompt(e.target.value)}
                    placeholder="e.g. A sleek laptop on a minimalist desk with morning coffee, perfect for a productivity app ad..."
                    rows={4}
                    className="w-full resize-y rounded-xl border border-zinc-700 bg-zinc-950 p-3 text-sm text-zinc-100 placeholder:text-zinc-500 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label htmlFor="platform" className="mb-2 block text-sm font-medium text-zinc-300">Platform</label>
                    <select id="platform" value={imagePlatform} onChange={(e) => setImagePlatform(e.target.value)}
                      className="w-full rounded-xl border border-zinc-700 bg-zinc-950 p-3 text-sm text-zinc-100 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500">
                      {PLATFORMS.map((p) => <option key={p} value={p}>{p}</option>)}
                    </select>
                  </div>
                  <div>
                    <label htmlFor="imageStyle" className="mb-2 block text-sm font-medium text-zinc-300">Visual Style</label>
                    <select id="imageStyle" value={imageStyle} onChange={(e) => setImageStyle(e.target.value)}
                      className="w-full rounded-xl border border-zinc-700 bg-zinc-950 p-3 text-sm text-zinc-100 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500">
                      {IMAGE_STYLES.map((s) => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </div>
                  <div>
                    <label htmlFor="imageTone" className="mb-2 block text-sm font-medium text-zinc-300">Tone</label>
                    <select id="imageTone" value={imageTone} onChange={(e) => setImageTone(e.target.value)}
                      className="w-full rounded-xl border border-zinc-700 bg-zinc-950 p-3 text-sm text-zinc-100 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500">
                      {IMAGE_TONES.map((t) => <option key={t} value={t}>{t}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="mb-2 block text-sm font-medium text-zinc-300">Number of images</label>
                    <div className="flex gap-2">
                      {[1, 2, 4].map((n) => (
                        <button key={n} onClick={() => setImageCount(n)}
                          className={`flex-1 rounded-xl border py-3 text-sm font-semibold transition ${
                            imageCount === n ? "border-indigo-500 bg-indigo-600/20 text-indigo-300" : "border-zinc-700 text-zinc-400 hover:border-zinc-500"
                          }`}>
                          {n}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                <button onClick={handleGenerateImages} disabled={loadingImages}
                  className="mt-2 w-full rounded-xl bg-pink-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-pink-500 disabled:cursor-not-allowed disabled:opacity-60">
                  {loadingImages ? "Generating images..." : "Generate Images"}
                </button>
              </div>
            </section>

            {imageError && <div className="mt-6 rounded-xl border border-red-800 bg-red-950/50 p-4 text-sm text-red-300">{imageError}</div>}

            {loadingImages && (
              <div className="mt-10 flex flex-col items-center gap-3 text-zinc-400">
                <div className="h-8 w-8 animate-spin rounded-full border-2 border-zinc-700 border-t-pink-500" />
                <p className="text-sm">Generating your images...</p>
              </div>
            )}

            {generatedImages.length > 0 && (
              <section className="mt-8">
                <h3 className="mb-4 text-lg font-semibold text-zinc-200">
                  Generated for <span className="text-pink-400">{imagePlatform}</span>
                </h3>
                <div className={`grid gap-4 ${generatedImages.length === 1 ? "grid-cols-1" : "grid-cols-2"}`}>
                  {generatedImages.map((img, i) =>
                    img.url ? (
                      <div key={i} className="group relative overflow-hidden rounded-2xl border border-zinc-800">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={img.url} alt={`Generated image ${i + 1}`} className="w-full object-cover" />
                        <div className="absolute inset-0 flex items-end bg-gradient-to-t from-black/60 to-transparent opacity-0 transition group-hover:opacity-100">
                          <a href={img.url} download={`creative-image-${i + 1}.png`} target="_blank" rel="noopener noreferrer"
                            className="m-4 w-full rounded-xl bg-white/20 px-4 py-2 text-center text-sm font-semibold text-white backdrop-blur-sm transition hover:bg-white/30">
                            Download
                          </a>
                        </div>
                      </div>
                    ) : null
                  )}
                </div>
              </section>
            )}
          </>
        )}
      </main>
    </div>
  );
}
