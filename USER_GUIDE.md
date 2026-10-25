# Velora — End-User Guide & Complete Workflow Walkthrough

> **Cinematic 3D scenes, motion mockups, and product B-roll made directly from your live React UI.**

This guide explains how **Velora** works from an end user's perspective, step by step, with practical workflows and concrete examples.

---

## 1. What is Velora?

Traditional product video creation requires:
- Recording your screen with screen-capture software (flat, 2D, low fidelity).
- Or exporting vector UI to Figma / After Effects and recreating layers manually.
- Or coding complex 3D scenes from scratch in Blender or Three.js without real React state, styles, or providers.

**Velora changes this paradigm:**
- It runs inside your **real React application** (Next.js App Router, Next.js Pages Router, Vite, or custom React/Electron).
- It uses your **real application components, CSS modules, Tailwind classes, theme providers, and live data**.
- It wraps those components in a 3D perspective viewport with realistic camera travel, depth of field, Gaussian lens blur, and smooth motion curves.
- You don't have to code 3D matrices by hand: you bring your favorite **AI coding agent** (Claude Code, Cursor, Windsurf, Codex, etc.) which reads Velora's built-in guide and authors the 3D scene files for you.
- You preview the scene in a dedicated **Studio interface** in your browser, scrub the timeline, and export high-definition **MP4 videos** at 30, 60, or 120 FPS.

---

## 2. Prerequisites

| Requirement | Details |
|---|---|
| **React Environment** | React DOM 18.2+ or 19 (Vite, Next.js, or custom React) |
| **Node.js** | Node 22.12+ |
| **AI Coding Agent** | Claude Code, Cursor, Windsurf, Codex CLI, or any repository-aware agent |
| **Video Export Tools** | Local **FFmpeg** and **Chromium** (via Playwright) for MP4 export |

---

## 3. The 5-Step End-User Journey

Here is what your end-to-end workflow looks like:

```
┌─────────────────┐       ┌─────────────────┐       ┌─────────────────┐
│ 1. Initialize   │ ----> │ 2. Prompt Agent │ ----> │ 3. Live Studio  │
│ npx velora init │       │ "Turn my navbar │       │ Preview & scrub │
│ in your app     │       │ into a 3D scene"│       │ on dev server   │
└─────────────────┘       └─────────────────┘       └─────────────────┘
                                                             │
                                                             ▼
┌─────────────────┐                                 ┌─────────────────┐
│ 5. Share/Deploy │ <------------------------------ │ 4. Export MP4   │
│ Use in landing  │                                 │ npx velora      │
│ page / social   │                                 │ export --fps 60 │
└─────────────────┘                                 └─────────────────┘
```

---

## 4. Step-by-Step Deep Dive

### Step 1: Install Velora into Your Existing App

Always start on a clean git branch:

```bash
# 1. Switch to a feature branch
git switch -c velora-scenes

# 2. Install the package
npm install @adityadeokar/velora

# 3. Initialize Velora in your project
npx velora init
```

#### What `npx velora init` does:
1. **Detects your framework**:
   - **Next.js (App or Pages Router)**: Sets up a zero-config `/velora` development-only route. It never touches your root layout, server components, or production bundle.
   - **Vite**: Connects to your development server seamlessly.
   - **Other React hosts**: Generates a clean portable adapter at `src/velora/ProjectPreview.tsx` that you mount with `enabled={isDev}`.
2. **Creates `VELORA.md`**: A handoff document in your root directory containing the exact instructions and prompts your AI coding agent needs.
3. **Creates the scene directory**: `src/velora/scenes/`, where all your 3D scenes will live.

---

### Step 2: Start Your App & Open the Studio

Start your regular development server:

```bash
npm run dev
```

Then open the Velora Studio:

```bash
# Option A: In Next.js, simply navigate in your browser to:
http://localhost:3000/velora

# Option B: Use the CLI helper (points to your running server):
npx velora open --url http://localhost:5173
```

---

### Step 3: What You See in the Studio (The Scene Library)

When you open the Studio for the first time:
- You are greeted by a sleek, dark-mode 3D viewport.
- If no scenes exist yet, you'll see **"A place for every perspective"** with a **"Connect your first scene"** card and a **"Copy starter prompt"** button.
- When scenes exist, they appear as a **tilted 3D plane receding into space** (like Star Wars movie credits). Native scrolling moves the plane through the camera's focal point.
- Each scene card shows:
  - Scene sequence number (`01`, `02`, etc.)
  - Thumbnail snapshot of the actual rendered UI
  - Scene title and description
  - Duration (e.g. `6s`) and a launch arrow (`↗`)

---

### Step 4: Generating a Scene with Your Coding Agent

You do not write 3D transformation matrices or bezier curve equations yourself. You give your coding agent this prompt (copied directly from the Studio or `VELORA.md`):

> *"Read `VELORA.md` and run `npx velora guide --json`. Inspect this app's real `DashboardAnalytics` component and create a cinematic Velora scene from it. Choose intentional close perspective, camera travel and depth of field. Preserve the app's design and theme providers. Save the scene in `src/velora/scenes/`."*

#### What Your Coding Agent Does:
The agent inspects your component (e.g., `src/components/DashboardAnalytics.tsx`) and writes **two synchronized files** in `src/velora/scenes/`:

1. **`dashboard.scene.json`** — The 3D Scene Recipe:
   - Sets the camera perspective, focal length, f-stop aperture, and max blur.
   - Defines the initial 3D transforms (`x`, `y`, `z`, `rotateX`, `rotateY`, `scale`) for surfaces.
   - Declares the motion keyframes (camera tracking shots, smooth pans, zooms).

2. **`dashboard.tsx`** — The React Scene Component:
   - Imports `{ Surface } from '@adityadeokar/velora'`.
   - Mounts your real application component inside `<Surface id="page">` or multiple nested surfaces (`<Surface id="card-1">`, `<Surface id="chart">`).
   - Wraps any needed providers (`<ThemeProvider>`, `<QueryClientProvider>`) so your UI looks 100% authentic.

#### Example of What the Code Looks Like:

```tsx
// src/velora/scenes/dashboard.tsx
import { Surface } from '@adityadeokar/velora';
import { DashboardAnalytics } from '../../components/DashboardAnalytics';
import { ThemeProvider } from '../../context/ThemeContext';

export default function DashboardScene() {
  return (
    <ThemeProvider>
      <Surface id="dashboard-canvas" style={{ width: 1400, height: 980 }}>
        <DashboardAnalytics />
      </Surface>
    </ThemeProvider>
  );
}
```

```json
// src/velora/scenes/dashboard.scene.json
{
  "version": 1,
  "id": "dashboard",
  "title": "Analytics Dashboard Survey",
  "description": "Slow cinematic pan across the revenue metrics and activity chart.",
  "definition": {
    "width": 1400,
    "height": 980,
    "scene": {
      "camera": {
        "perspective": 1400,
        "x": 0,
        "y": 0,
        "z": 0,
        "rotateX": 25,
        "rotateY": -15
      },
      "focus": {
        "distance": 1400,
        "fStop": 5.6,
        "focalLength": 85,
        "maxBlur": 8
      },
      "nodes": [
        { "id": "dashboard-canvas", "transform": { "x": 0, "y": 0, "z": 0 } }
      ]
    },
    "motion": {
      "durationMs": 6000,
      "speed": 0.5,
      "tracks": [
        {
          "target": { "kind": "camera" },
          "property": "x",
          "keyframes": [
            { "timeMs": 0, "value": -150, "easing": "cinematic" },
            { "timeMs": 6000, "value": 150, "easing": "cinematic" }
          ]
        }
      ]
    }
  }
}
```

---

### Step 5: Live Preview & Interactive Scrubbing

As soon as the agent saves the files, Vite hosts discover new scene pairs automatically. In Next.js and other hosts, run `npx velora sync` after adding or removing scene files. Edits to existing files hot-reload without restarting the server:

1. Click on the scene in the **Scene Library**.
2. The scene opens in **Scene Preview**:
   - The scene plays smoothly in full viewport cover mode.
   - Real-time Gaussian depth of field blurs elements further away from the lens focal plane.
   - At the bottom of the screen, a translucent control bar gives you:
     - **Play / Pause** toggle.
     - **Restart** button.
     - **Timeline Scrubber**: Drag through time to inspect exact frames.
     - **Time Readout**: Displays elapsed and total time (m:ss).
     - **Back button**: Returns to the Scene Library.
3. If you want to change something (e.g., *"Tilt the camera more to the left"* or *"Make the blur stronger on the background"*), ask your agent. The scene updates in real time via Hot Module Replacement (HMR).

---

### Step 6: Capturing Library Snapshots

To give your scene a crisp thumbnail in the Scene Library credits list:

```bash
npx velora snapshot --scene dashboard --url http://localhost:3000
```

Velora launches headless Chromium, seeks to the scene's midpoint (or the `--time <ms>` you choose), captures one frame and caches it inside the recipe metadata.

---

### Step 7: Exporting High-Quality MP4 Video

When your animation looks perfect:

The studio's **Export** menu prints the exact command for the open scene. For a Vite app on port 5173 it looks like this (in Next.js the scene URL is `http://localhost:3000/velora?velora-preview=1&velora-scene=dashboard`):

```bash
# Export standard 60 FPS MP4 video
npx velora export --url "http://localhost:5173/?velora-preview=1&velora-scene=dashboard" --output dashboard.mp4 --fps 60

# Or export ultra-smooth 120 FPS
npx velora export --url "http://localhost:5173/?velora-preview=1&velora-scene=dashboard" --output dashboard-120fps.mp4 --fps 120
```

#### How Video Export Works Behind the Scenes:
- Velora uses Playwright and a dedicated capture clock (`__VELORA_CAPTURE__`).
- It seeks the scene to each exact frame time, captures the scene viewport as a lossless PNG screenshot, and pipes the frames into FFmpeg to encode an H.264 MP4.
- Because every frame is sampled at an exact time, there are no dropped frames, no mouse cursor and no studio controls in the output.

---

### Step 8: Multi-Scene Compositions, Audio & Captions

You can string multiple scenes together into a complete product launch video:

1. Put media in `assets/` (an asset's ID is its filename without the extension, so `assets/music.mp3` is `music`; `npx velora assets ls` lists them). Then create `product-launch.composition.json` in the project root. Composition files must end in `.composition.json`:
   ```json
   {
     "version": 1,
     "id": "product-launch",
     "title": "Velora Product Launch",
     "width": 1920,
     "height": 1080,
     "fps": 60,
     "scenes": [
       { "id": "intro", "recipe": "hero-card", "startMs": 0, "durationMs": 4000 },
       { "id": "details", "recipe": "dashboard", "startMs": 4000, "durationMs": 6000,
         "transition": { "type": "focus-pull", "durationMs": 800 } }
     ],
     "assets": [
       { "id": "music", "path": "assets/music.mp3", "type": "audio" }
     ],
     "audio": [
       { "id": "bed", "assetId": "music", "startMs": 0, "gain": 0.8, "fadeOutMs": 1500 }
     ],
     "captions": { "file": "subs.srt", "burnIn": false }
   }
   ```
2. Validate it, then render the whole video with synchronized audio and captions:
   ```bash
   npx velora validate --composition product-launch.composition.json --json
   npx velora render --composition product-launch.composition.json --out product-launch.mp4
   ```

---

## 5. Helpful CLI Diagnostic Commands

Velora comes with a complete suite of verification and diagnostics:

| Command | What it does |
|---|---|
| `npx velora doctor` | Analyzes your project health, framework setup, dependencies, and dev server connectivity. |
| `npx velora guide` | Outputs the complete authoring guide, API contracts, and parameter references. |
| `npx velora scenes` | Lists all discovered scene recipes and validates their schemas. |
| `npx velora validate` | Validates composition files, scenes, audio assets, and timing budgets. |
| `npx velora frames` | Extracts every N-th frame as PNG stills for visual QA. |
| `npx velora check --video <file>` | Verifies audio drift, frame rate consistency, and stream integrity. |

---

## 6. Summary Checklist for Success

- [x] **Keep your real components untouched**: Never rewrite your production components for 3D; wrap them in `<Surface>` inside `src/velora/scenes/`.
- [x] **Preserve Providers**: If your component requires `<QueryClientProvider>` or `<ThemeProvider>`, wrap them inside your scene component file.
- [x] **Let the Agent Author the Math**: Rely on your coding agent and `npx velora guide` for keyframes and camera trajectories.
- [x] **Verify in the Studio**: Scrub and inspect before running export.
- [x] **Clean Production Builds**: Velora's integration is strictly excluded from your production bundles. Normal app routes remain completely untouched.
