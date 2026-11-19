# Label Studio

A browser-based editor for numbered labels — layers, text, serial numbers, shapes,
images, a brush engine, effects and print runs — with Photoshop-style **pixel
selections, layer masks and AI editing**.

All AI runs on **open-source models on your own machine**. There are no API keys,
accounts, subscriptions or per-use costs.

## Quick start

```bash
npm install
npm run dev               # the editor, http://localhost:5173
```

Optional, for the AI tools (in a second terminal):

```bash
cd ai-server
python3 -m venv .venv && . .venv/bin/activate
pip install -r requirements.txt            # the server + classical fallbacks (no GPU needed)
pip install -r requirements-models.txt     # the neural models (PyTorch, transformers, diffusers)
python -m label_ai                         # http://127.0.0.1:8765
```

The editor finds the server by itself (Window ▸ Generative AI shows its status and
lets you change the address). See [`ai-server/README.md`](ai-server/README.md) for
profiles, GPU notes, model licences and the HTTP API.

## Selections

A selection is a soft (anti-aliased, featherable) pixel mask over the whole label,
shown with marching ants. Shift adds, Alt subtracts, Shift+Alt intersects — or pick
the mode in the options bar.

| Tool | Key | Needs the AI server? |
|---|---|---|
| Rectangular / elliptical marquee | M (Shift+M cycles) | no |
| Lasso / polygonal lasso | L (Shift+L) | no |
| Object selection — click an object, or drag a box | W | yes (SAM; GrabCut fallback) |
| Quick selection — paint over an area | W (Shift+W) | no (AI assist uses SAM when available) |
| Magic wand — tolerance, contiguous, sample all layers | W (Shift+W) | no |

**Select menu**: All, Deselect, Reselect, Inverse; **Subject**, **Background**,
**Sky** and **Objects by description…** (AI); **Select and Mask…**; Modify ▸
Border / Smooth / Expand / Contract / Feather (in mm); load a selection from a
layer's pixels or mask.

**Select and Mask** (Ctrl+Alt+R) previews the result as an overlay, on black/white,
as a black-and-white mask or as ants. It offers an edge-detection radius with a
fine-detail (hair) mode — a guided filter that runs in the browser — smooth,
feather, contrast and shift edge. **Refine hair** uses the server's matting model
(BiRefNet-matting) when installed. Output goes to a selection, a layer mask or a
new masked layer.

## Layer masks

Any layer can have a mask: white reveals, black hides, greys blend. It is
non-destructive and prints exactly as shown.

- Layer ▸ Layer mask ▸ Reveal all / Hide all / Reveal selection / Hide selection,
  or the mask button in the Layers panel (uses the selection if there is one).
- Click the mask thumbnail to paint on it with the brush (foreground colour as a
  grey). Shift-click turns it off, Ctrl-click loads it as a selection, and
  right-click gives invert, apply (pixel layers), load and delete.
- Delete with a selection active hides those pixels via the mask (or clears them on
  a pixel layer) — it never deletes the layer. Ctrl+J copies the selected pixels to
  a new masked layer.

## Generative editing

Results land on **new layers** carrying the selection as their mask, so they can be
hidden, re-masked or deleted. Each request makes 1–4 results (3 by default, as in
Photoshop); flip between them or *Generate more* in the Generative AI panel. The
alternatives are kept for the session — the chosen one is saved with the design, and
after a reload *Generate more* rebuilds the request from the layers underneath.

| Feature | Where | Model capability |
|---|---|---|
| Generative fill (prompt, or empty = fill from surroundings) | task bar, AI panel, Edit menu | `inpaint` (`remove` when no prompt) |
| Generative replace | AI panel | `inpaint` |
| Prompt-free removal of a selection | task bar, AI panel | `remove` (LaMa) |
| Remove tool — paint over things | J | `remove` |
| Generative expand / outpainting | Image menu, task bar | `inpaint` or `remove` |
| Text to image (fills the selection, if any) | AI panel | `generate` (FLUX.1 schnell) |
| Generate similar (variations) | Image menu, task bar | `variations` |
| Edit with instructions | AI panel | `edit` (Qwen-Image-Edit, InstructPix2Pix) |
| Remove background (as a mask) | Image menu, task bar | `subject` (BiRefNet) |

Each capability's model can be chosen in AI panel ▸ Models. The server lists every
configured model and greys out the ones whose packages are not installed.

## Architecture

```
src/lib/selection/   pixel selection engine (pure TypeScript, unit tested)
  mask.ts              selection type, combine/invert, grid ↔ mm
  shapes.ts            anti-aliased polygon / ellipse / brush-stroke rasteriser
  morph.ts             exact distance-transform expand/contract, feather, smooth, border
  wand.ts              magic wand, classic quick selection
  refine.ts            Select and Mask (guided filter edge refinement)
  contour.ts           marching-ants outline (closed loops)
  compose.ts           renders the label/layers to pixels for analysis and AI input
  useSelection.ts      selection state, tool gestures, AI selection commands
src/lib/masks.ts     layer masks: geometry (rotation, crop, flips), CSS, storage
src/lib/layerOps.ts  selection × layer operations (mask from selection, Ctrl+J, …)
src/lib/ai/
  types.ts             capabilities, request/response shapes, the AiProvider interface
  http.ts              provider for the local server (sync calls + job queue, cancel)
  regions.ts           which part of the label a model sees, at what resolution
  useAi.ts             connection, model catalogue, the running job
  useGenerative.ts     fill / remove / expand / generate / similar / edit / variations
ai-server/           Python (FastAPI) model server with a pluggable registry
```

### Adding models

- **Another model of a supported kind** (a different SAM, an SDXL fine-tune, …): add
  an entry to `ai-server/models.toml`. It appears in the editor's model picker.
- **A new architecture**: drop an adapter file into `ai-server/label_ai/adapters/`
  implementing the capabilities it serves — see the server README.
- **A new kind of backend** (in-browser ONNX, another local runtime): implement
  `AiProvider` from `src/lib/ai/types.ts` and pass it to `useAi`.

## Development

```bash
npm run ci                       # typecheck, lint, unit + integration tests, build
cd ai-server && pytest -q        # server tests (no GPU or PyTorch needed)
```
