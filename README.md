# AI Video Script Engine

Turn any video script into a structured, shot-by-shot storyboard plan — instantly. No video is generated; this is a planning and pre-production tool.

---

## What It Does

Paste your script, pick a style, and the engine breaks it down into a full storyboard with:

- Voiceover text per scene
- Visual prompt (ready to paste into an AI image/video tool)
- B-roll ideas
- Caption text
- Camera movement
- Editing notes
- Sound effects
- Color palette & music style recommendations

---

## Styles Available

| Style | Best For |
|---|---|
| TikTok Ad | Short-form, fast-paced social content |
| Cinematic | High-production film-style videos |
| Documentary | Informative, narration-driven content |
| Luxury Brand | Premium, aspirational brand videos |
| Funny Meme | Comedic, viral-style content |
| Startup Promo | Product launches and pitch videos |

---

## How to Use

### 1. Enter Your Script
Paste or type your video script into the text area. This can be a rough outline, a voiceover script, or a full screenplay.

### 2. Choose a Style
Select the style that best matches your target audience and platform from the dropdown.

### 3. Generate Storyboard
Click **Generate Storyboard**. The engine will analyze your script and return a full scene-by-scene plan in seconds.

### 4. Review Your Scenes
Each card represents one scene and includes all the details a director, editor, or AI video tool would need.

### 5. Copy a Visual Prompt
Click **Copy Prompt** on any scene card to copy the visual prompt straight to your clipboard — ready to paste into tools like Midjourney, Runway, or Sora.

---

## Running Locally

### Prerequisites
- Node.js 18+
- An [OpenAI API key](https://platform.openai.com/api-keys)

### Setup

```bash
# Install dependencies
npm install

# Add your OpenAI key
cp .env.local.example .env.local
# Then edit .env.local and replace the placeholder with your real key

# Start the dev server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

---

## Tech Stack

- [Next.js 16](https://nextjs.org) (App Router)
- [TypeScript](https://www.typescriptlang.org)
- [Tailwind CSS](https://tailwindcss.com)
- [OpenAI API](https://platform.openai.com) (GPT-4o mini)
