# label_ai — local AI server for the label editor

A small, self-hosted HTTP server that gives the browser editor Photoshop-style AI tools:
click/box selection, "select subject", select-by-text, edge refinement (matting),
object removal, prompted inpainting, text-to-image, "generate similar" and
instruction-based editing.

* **No paid APIs, no subscriptions, no telemetry.** Only open-source / open-weight models,
  running on your machine (CUDA GPU, Apple Silicon MPS, or CPU).
* **Pluggable.** Models are declared in `models.toml`; new architectures are a single
  adapter file in `label_ai/adapters/`.
* **Works without a GPU or PyTorch.** With only the core requirements the server runs
  classical OpenCV/numpy fallbacks for selection, subject, matting and removal.
  Generative features appear once the ML requirements are installed.

## Setup

Python 3.10+ (3.11+ recommended).

```bash
cd ai-server
python3 -m venv .venv
source .venv/bin/activate            # Windows: .venv\Scripts\activate

# 1. Core server (classical models only, ~100 MB)
pip install -r requirements.txt

# 2. Optional: neural models (PyTorch, transformers, diffusers…)
#    Install the right torch build first if pip's default does not match your hardware, e.g.
#    pip install torch torchvision --index-url https://download.pytorch.org/whl/cu124
pip install -r requirements-models.txt

# Tests / development
pip install pytest httpx           # or: pip install -e ".[dev]"
```

> Debian/Ubuntu without `python3-venv`: `python3 -m venv --without-pip .venv` then
> `curl -sS https://bootstrap.pypa.io/get-pip.py | .venv/bin/python`.

Model weights are **not** bundled. They download lazily into the Hugging Face cache
(`~/.cache/huggingface`, override with `HF_HOME`) the first time a model is used; the job
`message` shows `Loading model <id>…` meanwhile. To pre-fetch, run one request per model, or
`hf download <repo>`.

**FLUX.1-schnell is gated** (free, Apache-2.0): accept the terms once at
<https://huggingface.co/black-forest-labs/FLUX.1-schnell> and log in with `hf auth login`
(or set `HF_TOKEN`). All other configured repos are ungated.

## Running

```bash
python -m label_ai                                  # http://127.0.0.1:8765, profile "standard"
python -m label_ai --profile lite --device cpu
python -m label_ai --port 8799 --allow-origin https://labels.example.com
```

| flag | default | |
|---|---|---|
| `--host` | `127.0.0.1` | The server has **no authentication** — keep it on loopback. |
| `--port` | `8765` | |
| `--config` | `ai-server/models.toml` | Model registry file. |
| `--profile` | `standard` (from `[server].default_profile`) | `lite`, `standard`, `quality`. |
| `--device` | `auto` | `auto` picks cuda → mps → cpu. |
| `--allow-origin` | – | Extra CORS origin (repeatable). `http(s)://localhost|127.0.0.1|[::1]` on any port are always allowed. |
| `--max-loaded` | `2` | Heavy models kept resident (LRU unload). |
| `--log-level` | `info` | |

Environment equivalents: `LABEL_AI_HOST`, `LABEL_AI_PORT`, `LABEL_AI_CONFIG`,
`LABEL_AI_PROFILE`, `LABEL_AI_DEVICE`. Interactive API docs: `http://127.0.0.1:8765/api/docs`.

Requests whose `Host` header is not a loopback name (or the `--host` you bound) are
rejected, which blocks DNS-rebinding attacks from web pages.

## Profiles

A profile picks the default model for each capability. If a default is unavailable
(its Python packages are missing), the first available model for that capability (in
`models.toml` order) is used instead — so with only the core requirements the classical
models become the defaults.

| capability | lite (CPU-friendly) | standard (8–16 GB GPU) | quality (24 GB+ GPU) |
|---|---|---|---|
| segment | slimsam | sam-vit-base | sam2.1-hiera-small |
| subject | birefnet-lite | birefnet | birefnet |
| segment_text | clipseg | clipseg | grounded-sam |
| matte | guided-filter | birefnet-matting | birefnet-matting |
| remove | lama | lama | lama |
| inpaint | sd15-inpaint | sdxl-inpaint | flux-schnell-inpaint |
| generate | sd15 | flux-schnell | flux-schnell |
| variations | sd15 | flux-schnell | flux-schnell |
| edit | instruct-pix2pix | instruct-pix2pix | qwen-image-edit |

The client can always pick any available model explicitly with `"model": "<id>"`.

## Models

All models are free and open-weight. Sizes are download sizes (fp16 variants where used).
Non-commercial models (e.g. RMBG-1.4/2.0, SDXL-Turbo, SD-Turbo, FLUX.1-dev / Fill-dev) are
deliberately **not** included.

| id | capability | repo | license | size | notes |
|---|---|---|---|---|---|
| sam-vit-base | segment | facebook/sam-vit-base | Apache-2.0 | 375 MB | |
| sam2.1-hiera-small | segment | facebook/sam2.1-hiera-small | Apache-2.0 | 185 MB | needs transformers ≥ 4.56 |
| slimsam | segment | Zigeng/SlimSAM-uniform-77 | Apache-2.0 | 39 MB | |
| birefnet | subject | ZhengPeng7/BiRefNet | MIT | 445 MB | `trust_remote_code` |
| birefnet-lite | subject | ZhengPeng7/BiRefNet_lite | MIT | 180 MB | `trust_remote_code` |
| clipseg | segment_text | CIDAS/clipseg-rd64-refined | Apache-2.0 | 605 MB | |
| grounded-sam | segment_text | IDEA-Research/grounding-dino-tiny + facebook/sam-vit-base | Apache-2.0 | 690 + 375 MB | |
| birefnet-matting | matte | ZhengPeng7/BiRefNet-matting | MIT | 885 MB | `trust_remote_code` |
| lama | remove | fashn-ai/LaMa (`big-lama.pt`, TorchScript) | Apache-2.0 (LaMa) | 206 MB | mirror repo has no license tag; the weights are the Apache-2.0 big-lama release. Alternative `url` in models.toml. |
| sd15-inpaint | inpaint | stable-diffusion-v1-5/stable-diffusion-inpainting | CreativeML OpenRAIL-M ⚠ | 2.1 GB | |
| sdxl-inpaint | inpaint | diffusers/stable-diffusion-xl-1.0-inpainting-0.1 | CreativeML OpenRAIL++-M ⚠ | 6.9 GB | fp16-fix VAE (madebyollin/sdxl-vae-fp16-fix, MIT) |
| flux-schnell-inpaint | inpaint | black-forest-labs/FLUX.1-schnell | Apache-2.0 | 34 GB | gated (free); same weights as flux-schnell |
| flux-schnell | generate, variations | black-forest-labs/FLUX.1-schnell | Apache-2.0 | 34 GB | gated (free); 4 steps |
| sdxl | generate, variations | stabilityai/stable-diffusion-xl-base-1.0 | CreativeML OpenRAIL++-M ⚠ | 7.1 GB | |
| sd15 | generate, variations | stable-diffusion-v1-5/stable-diffusion-v1-5 | CreativeML OpenRAIL-M ⚠ | 2.1 GB | |
| qwen-image-edit | edit | Qwen/Qwen-Image-Edit | Apache-2.0 | 58 GB | ~64 GB VRAM, or CPU offload (needs lots of system RAM; slow) |
| instruct-pix2pix | edit | timbrooks/instruct-pix2pix | MIT ⚠ | 2.1 GB | SD 1.5 derived |
| grabcut | segment | – (OpenCV) | Apache-2.0 | – | classical, no torch |
| grabcut-center | subject | – (OpenCV) | Apache-2.0 | – | classical "basic" subject |
| guided-filter | matte | – (numpy) | MIT | – | classical |
| opencv-telea | remove | – (OpenCV) | Apache-2.0 | – | classical |

⚠ **OpenRAIL licenses** allow commercial use but carry *use-based restrictions* (no
illegal/harmful uses, etc.) that must be passed on to users. Everything else is permissive
(Apache-2.0 / MIT). SD 1.5 pipelines keep their safety checker by default
(`safety_checker = false` in models.toml disables it).

### Hardware notes

* **CPU only (no GPU):** everything works but diffusion is slow (SD 1.5 at 512 px: roughly
  1–3 min/image). Use `--profile lite`. FLUX / SDXL / Qwen are not practical on CPU.
* **FLUX.1-schnell:** ~34 GB in bf16. `offload = "auto"` keeps it fully on the GPU with
  ≥ 36 GB VRAM, uses model CPU offload with ≥ 26 GB and sequential offload (slow) below.
  Needs ~40 GB system RAM when offloading.
* **Qwen-Image-Edit:** 20B diffusion transformer + 7B VL text encoder (~58 GB bf16). Realistic
  on 80 GB GPUs or with offload. Set `offload = "sequential"` on 24 GB cards.
* `exclusive = true` models unload every other heavy model before loading.

## Adding models

### A new model for an existing architecture → TOML only

```toml
[models."sam-vit-huge"]
adapter = "sam"                       # any registered adapter
name = "Segment Anything (ViT-H)"
description = "Largest SAM 1 model."
license = "Apache-2.0"
size = "2.5 GB"
repo = "facebook/sam-vit-huge"
dtype = "float16"                     # adapter options are free-form

[models."my-sdxl-finetune"]
adapter = "diffusion"
family = "sdxl"                       # sd15 | sdxl | flux
repo = "someone/some-sdxl-finetune"
capabilities = ["generate", "variations"]
license = "CreativeML-OpenRAIL++-M"
steps = 25
```

Then optionally make it a profile default: `[profiles.quality.defaults] segment = "sam-vit-huge"`.
New diffusers pipelines can also be wired from TOML with
`pipelines = { generate = "SomeNewPipeline", variations = "SomeNewImg2ImgPipeline" }`.

### A new architecture → one adapter file

Create `label_ai/adapters/my_matting.py` (every module in that package is imported
automatically):

```python
from ..registry import register_adapter
from .base import Adapter, RunContext


@register_adapter("my_matting")
class MyMatting(Adapter):
    capabilities = ("matte",)                    # what it can serve
    requires = ("torch", "transformers")         # checked with importlib.util.find_spec
    min_versions = {"transformers": "4.50"}      # optional

    def load(self, device, dtype):               # heavy imports ONLY inside methods
        from transformers import AutoModel
        self.model = AutoModel.from_pretrained(self.repo).to(device, dtype).eval()

    def unload(self):
        self.model = None

    def matte(self, params: dict, ctx: RunContext) -> dict:
        image, mask = params["image"], params["mask"]    # validated PIL images (RGB, L)
        ctx.progress(0.5, "Refining…")
        ctx.check_cancelled()                            # raises if the job was cancelled
        alpha = ...                                      # PIL "L" image or float array 0..1
        return {"mask": alpha}                           # server encodes + resizes to request size
```

and reference it:

```toml
[models.my-matting]
adapter = "my_matting"
name = "My matting model"
license = "MIT"
repo = "me/my-matting"
```

Adapter contract:

* Methods are named after capabilities and receive validated `params` (images decoded to
  PIL, masks resized to the image) and a `RunContext` (`progress(fraction, message)`,
  `message(text)`, `check_cancelled()`, `subrange(lo, hi)`).
* Return PIL images/masks at any size — the server resizes them back to the request image
  size (or `width`×`height` for `generate`) and encodes PNG data URLs.
* Set `heavy = False` for CPU-only classical adapters (they then skip the GPU lock and
  don't count against `max_loaded`).
* Diffusers adapters can reuse `load_pipeline`, `place_pipeline` (offload) and
  `call_pipeline` (progress + cancellation via `callback_on_step_end`) from
  `adapters/diffusion.py`.

## HTTP API

Base URL `http://127.0.0.1:8765`. JSON bodies. Images in requests are data URLs
(`data:image/png|jpeg|webp;base64,…`, ≤ 4096 px per side; transparent pixels are composited
on white). Masks in requests are PNG data URLs, read as grayscale — or as alpha when the colour
channels are uniform; white = selected / to fill. Coordinates are in the request image's
pixels.

Responses: masks are PNG data URLs (mode `L`, 0–255, soft edges allowed); images are PNG
data URLs. Both are exactly the request `image` size (or `width`×`height` for `generate`).

### Endpoints

| method | path | response |
|---|---|---|
| GET | `/api/health` | `{"status":"ok","version":"1.0.0","device":"cuda\|mps\|cpu","profile":"…"}` |
| GET | `/api/models` | `{"capabilities": {"<cap>": {"default": id\|null, "models": [ModelInfo…]}}}` (all 9 keys always present) |
| POST | `/api/run/{capability}` | body `{"model"?: id, "params": {…}}` → capability result (synchronous) |
| POST | `/api/jobs` | body `{"capability", "model"?, "params"}` → **202** `{"id","status":"queued"}` |
| GET | `/api/jobs/{id}` | `{"id","capability","model","status","progress","message","result","error"}` |
| DELETE | `/api/jobs/{id}` | `{"id","status"}` — cancels (queued → `cancelled` immediately; running → stops at next step) |
| POST | `/api/models/{id}/unload` | `{"id","loaded":false}` |

`ModelInfo = {"id","name","capabilities","description","license","available","loaded","reason","size"}`.
`available` only checks that the Python packages are importable (no downloads);
`reason` says what to install when it is `false`.

Job `status` is `queued | running | done | error | cancelled`; `progress` 0..1 (diffusion
reports step/total); `message` e.g. `"Loading model sam-vit-base…"`; `error` is
`{"code","message"}` (code `cancelled` for cancelled jobs). Finished jobs are kept 10
minutes; at most 16 jobs may be pending.

### Capabilities

| capability | params | result |
|---|---|---|
| `segment` | `image`, `points?: [{x,y,label}]` (1 fg / 0 bg), `boxes?: [[x0,y0,x1,y1]]`, `multimask?: bool` | `{"mask","score"}` |
| `subject` | `image` | `{"mask"}` |
| `segment_text` | `image`, `prompt`, `threshold?` (0..1, default 0.35) | `{"mask","found"}` |
| `matte` | `image`, `mask`, `radius?` (px, default 10) | `{"mask"}` |
| `remove` | `image`, `mask` | `{"images":[url],"seeds":[0]}` |
| `inpaint` | `image`, `mask`, `prompt`, `negative_prompt?`, `count?` 1–4, `seed?`, `steps?`, `guidance?`, `strength?` (0,1] | `{"images","seeds"}` |
| `generate` | `prompt`, `negative_prompt?`, `width`, `height` (64–2048), `count?`, `seed?`, `steps?`, `guidance?` | `{"images","seeds"}` |
| `variations` | `image`, `prompt?`, `strength?` (default 0.55), `count?`, `seed?`, `steps?`, `guidance?` | `{"images","seeds"}` |
| `edit` | `image`, `instruction`, `count?`, `seed?`, `steps?`, `guidance?` | `{"images","seeds"}` |

Details:

* `segment`: at least one point or box. Several boxes → union of their masks (points are
  applied to every box). `multimask` omitted → on for a single click without a box (SAM
  picks the best of 3 candidates). Image embeddings are cached (LRU, 4 images), so repeated
  clicks on the same image are fast.
* `inpaint` returns full images with the original pixels pasted back outside the (slightly
  grown, feathered) mask. With `seed` the images use `seed, seed+1, …`; without, a random
  seed is chosen and returned.
* `steps` = denoising steps actually executed; for img2img/inpaint with `strength < 1` the
  scheduler length is scaled so roughly `steps` steps run.
* `guidance` maps to `guidance_scale` (Qwen-Image-Edit: `true_cfg_scale`). FLUX.1-schnell
  ignores guidance and negative prompts.

### Errors

`{"error": {"code": str, "message": str}}` with HTTP status:

| status | code | when |
|---|---|---|
| 400 | `bad_request` | invalid JSON / params / image, bad `Host` header |
| 404 | `not_found` | unknown capability, model id, job id or route |
| 409 | `model_unavailable` | model deps missing, model doesn't serve the capability, no model available, gated repo not accepted |
| 429 | `busy` | job queue full |
| 500 | `internal` | anything else (details in the server log) |

Precedence: capability → model resolution → params validation.

### Example

```bash
curl -s localhost:8765/api/jobs -H 'content-type: application/json' -d '{
  "capability": "generate",
  "params": {"prompt": "a vintage jam jar label, flat illustration", "width": 768, "height": 512, "seed": 1}
}'
# {"id":"3f2c…","status":"queued"}
curl -s localhost:8765/api/jobs/3f2c…
```

## Development

```bash
pip install -r requirements.txt pytest httpx
pytest -q          # runs without torch: classical adapters + fake adapters registered in tests
```

Layout: `label_ai/server.py` (FastAPI app/routes), `jobs.py` (single worker queue),
`registry.py` (adapters, config, load/unload), `params.py` (validation), `imageio.py`
(data URLs, masks, resizing), `device.py` (device/dtype), `adapters/*` (models).
