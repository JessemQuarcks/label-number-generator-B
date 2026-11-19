import time

import numpy as np
import pytest
from fastapi.testclient import TestClient
from PIL import Image

from label_ai import CAPABILITIES
from label_ai.registry import Registry
from label_ai.server import create_app

from .conftest import OBJ_BOX, data_url, decode_url


def assert_error(resp, status, code):
    assert resp.status_code == status, resp.text
    body = resp.json()
    assert set(body) == {"error"} and body["error"]["code"] == code and body["error"]["message"]


def wait_for(client, job_id, statuses, timeout=10.0):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        job = client.get(f"/api/jobs/{job_id}").json()
        if job["status"] in statuses:
            return job
        time.sleep(0.02)
    raise AssertionError(f"job {job_id} never reached {statuses}: {job}")


# --------------------------------------------------------------------------- info endpoints


def test_health(client):
    r = client.get("/api/health")
    assert r.status_code == 200
    assert r.json() == {"status": "ok", "version": "1.0.0", "device": "cpu", "profile": "standard"}


def test_models_shape(client):
    caps = client.get("/api/models").json()["capabilities"]
    assert list(caps) == list(CAPABILITIES)
    keys = {"id", "name", "capabilities", "description", "license", "available", "loaded", "reason", "size"}
    for cap, info in caps.items():
        assert set(info) == {"default", "models"}
        for m in info["models"]:
            assert set(m) == keys and cap in m["capabilities"]
    assert caps["segment"]["default"] == "grabcut"
    assert caps["generate"]["default"] == "fake"
    assert caps["edit"] == {"default": None, "models": []}
    seg = {m["id"]: m for m in caps["segment"]["models"]}
    assert seg["grabcut"]["available"] and seg["grabcut"]["reason"] is None
    assert not seg["unavailable-model"]["available"]
    assert "definitely_not_an_installed_module_xyz" in seg["unavailable-model"]["reason"]


def test_real_config_models_endpoint():
    reg = Registry.from_file(device="cpu")
    with TestClient(create_app(reg), base_url="http://127.0.0.1") as c:
        caps = c.get("/api/models").json()["capabilities"]
    assert list(caps) == list(CAPABILITIES)
    for cap in ("segment", "subject", "matte", "remove"):
        assert any(m["available"] for m in caps[cap]["models"])
    from label_ai.registry import module_available
    if not module_available("torch"):
        sam = next(m for m in caps["segment"]["models"] if m["id"] == "sam-vit-base")
        assert sam["available"] is False and "pip install" in sam["reason"]
        assert caps["segment"]["default"] == "grabcut"
        assert caps["generate"]["default"] is None


# --------------------------------------------------------------------------- CORS / host


def test_cors_localhost_vite(client):
    r = client.get("/api/health", headers={"Origin": "http://localhost:5173"})
    assert r.headers["access-control-allow-origin"] == "http://localhost:5173"
    pre = client.options("/api/run/segment", headers={
        "Origin": "http://localhost:5173", "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "content-type"})
    assert pre.status_code == 200
    assert pre.headers["access-control-allow-origin"] == "http://localhost:5173"


@pytest.mark.parametrize("origin,allowed", [
    ("http://127.0.0.1:3000", True), ("http://[::1]:5173", True), ("https://labels.example.com", True),
    ("https://evil.example.com", False), ("http://localhost.evil.com", False)])
def test_cors_origins(client, origin, allowed):
    r = client.get("/api/health", headers={"Origin": origin})
    assert (r.headers.get("access-control-allow-origin") == origin) is allowed


def test_cors_headers_on_errors(client):
    r = client.post("/api/run/segment", json={"model": "nope", "params": {}},
                    headers={"Origin": "http://localhost:5173"})
    assert r.status_code == 404 and r.headers["access-control-allow-origin"] == "http://localhost:5173"


def test_foreign_host_header_rejected(client):
    assert_error(client.get("/api/health", headers={"Host": "attacker.example.com"}), 400, "bad_request")
    assert client.get("/api/health", headers={"Host": "127.0.0.1:8765"}).status_code == 200
    assert client.get("/api/health", headers={"Host": "[::1]:8765"}).status_code == 200


# --------------------------------------------------------------------------- classical capabilities


def test_grabcut_segment_box(client, synthetic_image):
    x0, y0, x1, y1 = OBJ_BOX
    r = client.post("/api/run/segment", json={"model": "grabcut", "params": {
        "image": data_url(synthetic_image), "boxes": [[x0 - 10, y0 - 10, x1 + 10, y1 + 10]]}})
    assert r.status_code == 200, r.text
    body = r.json()
    assert set(body) == {"mask", "score"} and isinstance(body["score"], float)
    mask = decode_url(body["mask"])
    assert mask.mode == "L" and mask.size == synthetic_image.size
    m = np.asarray(mask, dtype=np.float32) / 255
    inside = m[y0 + 5:y1 - 5, x0 + 5:x1 - 5].mean()
    outside = np.concatenate([m[:, : x0 - 12].ravel(), m[:, x1 + 12:].ravel(),
                              m[: y0 - 12].ravel(), m[y1 + 12:].ravel()]).mean()
    assert inside > 0.9 and outside < 0.02, (inside, outside)


def test_grabcut_segment_points_and_default_model(client, synthetic_image):
    r = client.post("/api/run/segment", json={"params": {
        "image": data_url(synthetic_image), "points": [{"x": 80, "y": 60, "label": 1}, {"x": 5, "y": 5, "label": 0}]}})
    assert r.status_code == 200, r.text
    m = np.asarray(decode_url(r.json()["mask"]), dtype=np.float32) / 255
    assert m.shape == (120, 160)
    assert m[60, 80] > 0.9 and m[5, 5] < 0.1


def test_grabcut_multiple_boxes_union(client):
    arr = np.full((100, 200, 3), 128, np.uint8)
    arr[20:60, 20:60] = (0, 0, 220)
    arr[40:80, 130:170] = (0, 200, 0)
    img = Image.fromarray(arr)
    r = client.post("/api/run/segment", json={"model": "grabcut", "params": {
        "image": data_url(img), "boxes": [[10, 10, 70, 70], [120, 30, 180, 90]]}})
    m = np.asarray(decode_url(r.json()["mask"]), dtype=np.float32) / 255
    assert m[40, 40] > 0.9 and m[60, 150] > 0.9 and m[50, 100] < 0.1


def test_subject_grabcut_center(client, synthetic_image):
    r = client.post("/api/run/subject", json={"model": "grabcut-center", "params": {"image": data_url(synthetic_image)}})
    assert r.status_code == 200, r.text
    mask = decode_url(r.json()["mask"])
    assert mask.size == synthetic_image.size and mask.mode == "L"
    assert mask.getpixel((80, 60)) > 200


def test_subject_mask_resized_back_to_request_size(client, synthetic_image):
    # the fake adapter returns a half-size mask; the server must resize it
    r = client.post("/api/run/subject", json={"model": "fake-slow", "params": {"image": data_url(synthetic_image)}})
    assert r.status_code == 200
    assert decode_url(r.json()["mask"]).size == synthetic_image.size


def test_remove_opencv_telea(client, synthetic_image, square_mask):
    r = client.post("/api/run/remove", json={"model": "opencv-telea", "params": {
        "image": data_url(synthetic_image, "JPEG"), "mask": data_url(square_mask)}})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["seeds"] == [0] and len(body["images"]) == 1
    out = decode_url(body["images"][0])
    assert out.size == synthetic_image.size
    r_, g_, b_ = out.getpixel((80, 60))[:3]
    assert r_ < 190 and abs(r_ - g_) < 60  # the red square has been filled with grey-ish background


def test_matte_guided_filter(client, synthetic_image, square_mask):
    rough = square_mask.resize((40, 30)).resize(square_mask.size)  # blocky/blurred edge
    r = client.post("/api/run/matte", json={"model": "guided-filter", "params": {
        "image": data_url(synthetic_image), "mask": data_url(rough), "radius": 6}})
    assert r.status_code == 200, r.text
    out = decode_url(r.json()["mask"])
    assert out.size == synthetic_image.size and out.mode == "L"
    a = np.asarray(out)
    assert a[60, 80] == 255 and a[2, 2] == 0           # known regions are kept
    x0, y0, x1, y1 = OBJ_BOX
    assert a[60, x0 + 1] > 128 and a[60, x0 - 3] < 128  # the edge snaps to the real boundary


# --------------------------------------------------------------------------- generate (fake heavy adapter)


def test_generative_results_match_request_image_size(client, synthetic_image, square_mask):
    img, mask = data_url(synthetic_image), data_url(square_mask.resize((40, 30)))
    r = client.post("/api/run/inpaint", json={"model": "fake-all", "params": {
        "image": img, "mask": mask, "prompt": "x", "count": 2, "seed": 9}})
    assert r.status_code == 200, r.text
    assert r.json()["seeds"] == [9, 10]
    assert [decode_url(u).size for u in r.json()["images"]] == [synthetic_image.size] * 2
    r = client.post("/api/run/segment_text", json={"model": "fake-all", "params": {"image": img, "prompt": "sky"}})
    assert r.status_code == 200 and r.json()["found"] is False and set(r.json()) == {"mask", "found"}
    assert decode_url(r.json()["mask"]).getextrema() == (0, 0)


def test_generate_sync_exact_size_and_seeds(client):
    r = client.post("/api/run/generate", json={"model": "fake", "params": {
        "prompt": "a label", "width": 200, "height": 120, "count": 3, "seed": 41}})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["seeds"] == [41, 42, 43]
    assert [decode_url(u).size for u in body["images"]] == [(200, 120)] * 3


# --------------------------------------------------------------------------- validation / errors


@pytest.mark.parametrize("cap,params,fragment", [
    ("segment", {}, "image"),
    ("segment", {"image": "IMG"}, "point or box"),
    ("segment", {"image": "IMG", "points": [{"x": "a", "y": 1}]}, "points[0].x"),
    ("segment", {"image": "IMG", "points": [{"x": 1, "y": 1, "label": 3}]}, "label"),
    ("segment", {"image": "IMG", "boxes": [[1, 2, 3]]}, "boxes[0]"),
    ("segment", {"image": "data:image/gif;base64,R0lGODlh", "boxes": [[0, 0, 5, 5]]}, "unsupported"),
    ("segment_text", {"image": "IMG", "prompt": "  "}, "prompt"),
    ("segment_text", {"image": "IMG", "prompt": "sky", "threshold": 1.5}, "threshold"),
    ("generate", {"prompt": "x", "width": 32, "height": 64}, "width"),
    ("generate", {"prompt": "x", "width": 64, "height": 4096}, "height"),
    ("generate", {"prompt": "x", "width": 64, "height": 64, "count": 5}, "count"),
    ("generate", {"prompt": "x", "width": 64, "height": 64, "steps": 2.5}, "steps"),
    ("generate", {"prompt": "x", "width": True, "height": 64}, "width"),
    ("inpaint", {"image": "IMG", "prompt": "x"}, "mask"),
    ("inpaint", {"image": "IMG", "mask": "IMG", "prompt": "x", "strength": 0}, "strength"),
    ("variations", {"image": "IMG", "seed": -1}, "seed"),
    ("matte", {"image": "IMG", "mask": "IMG", "radius": 0}, "radius"),
])
def test_validation_errors_are_400(client, synthetic_image, cap, params, fragment):
    img = data_url(synthetic_image)
    params = {k: (img if v == "IMG" else v) for k, v in params.items()}
    model = {"segment": "grabcut", "segment_text": "fake-all", "generate": "fake", "inpaint": "fake-all",
             "variations": "fake-all", "matte": "guided-filter"}[cap]
    r = client.post(f"/api/run/{cap}", json={"model": model, "params": params})
    assert_error(r, 400, "bad_request")
    assert fragment in r.json()["error"]["message"]
    r = client.post("/api/jobs", json={"capability": cap, "model": model, "params": params})
    assert_error(r, 400, "bad_request")


def test_param_validation_without_model(synthetic_image):
    from label_ai.errors import ApiError
    from label_ai.params import validate
    img = data_url(synthetic_image)
    for cap, params in [("segment_text", {"image": img, "prompt": " "}),
                        ("inpaint", {"image": img, "prompt": "x"}),
                        ("inpaint", {"image": img, "mask": img, "prompt": "x", "count": 0}),
                        ("variations", {"image": img, "strength": 1.2}),
                        ("edit", {"image": img, "instruction": ""})]:
        with pytest.raises(ApiError) as e:
            validate(cap, params)
        assert e.value.status == 400
    ok = validate("inpaint", {"image": img, "mask": img, "prompt": "x", "count": 2, "seed": 7})
    assert ok["seeds"] == [7, 8] and ok["mask"].size == ok["image"].size


def test_oversized_image_400(client):
    big = data_url(Image.new("RGB", (4100, 8)))
    assert_error(client.post("/api/run/segment", json={"model": "grabcut", "params": {
        "image": big, "boxes": [[0, 0, 4, 4]]}}), 400, "bad_request")


def test_bad_bodies(client):
    assert_error(client.post("/api/run/segment", content=b"{not json", headers={"content-type": "application/json"}),
                 400, "bad_request")
    assert_error(client.post("/api/run/segment", json=[1, 2]), 400, "bad_request")
    assert_error(client.post("/api/run/segment", json={"model": 5, "params": {}}), 400, "bad_request")
    assert_error(client.post("/api/jobs", json={"params": {}}), 400, "bad_request")


def test_unknown_model_and_capability(client, synthetic_image):
    p = {"image": data_url(synthetic_image), "boxes": [[0, 0, 10, 10]]}
    assert_error(client.post("/api/run/segment", json={"model": "nope", "params": p}), 404, "not_found")
    assert_error(client.post("/api/run/segment", json={"model": "opencv-telea", "params": p}), 409, "model_unavailable")
    assert_error(client.post("/api/run/segment", json={"model": "unavailable-model", "params": p}), 409,
                 "model_unavailable")
    assert_error(client.post("/api/run/edit", json={"params": {"image": p["image"], "instruction": "x"}}), 409,
                 "model_unavailable")
    assert_error(client.post("/api/run/teleport", json={"params": {}}), 404, "not_found")
    assert_error(client.post("/api/jobs", json={"capability": "teleport", "params": {}}), 404, "not_found")
    assert_error(client.post("/api/jobs", json={"capability": "segment", "model": "nope", "params": p}), 404,
                 "not_found")
    assert_error(client.get("/api/jobs/doesnotexist"), 404, "not_found")
    assert_error(client.delete("/api/jobs/doesnotexist"), 404, "not_found")
    assert_error(client.get("/api/nothing-here"), 404, "not_found")
    assert_error(client.post("/api/models/nope/unload"), 404, "not_found")


# --------------------------------------------------------------------------- jobs


def test_job_lifecycle(client):
    r = client.post("/api/jobs", json={"capability": "generate", "model": "fake", "params": {
        "prompt": "x", "width": 64, "height": 96, "count": 2, "seed": 5}})
    assert r.status_code == 202
    body = r.json()
    assert body["status"] == "queued" and set(body) == {"id", "status"}
    job_id = body["id"]
    running = wait_for(client, job_id, {"running", "done"})
    seen_progress = []
    job = running
    while job["status"] == "running":
        seen_progress.append(job["progress"])
        time.sleep(0.02)
        job = client.get(f"/api/jobs/{job_id}").json()
    assert job["status"] == "done", job
    assert job["progress"] == 1.0 and job["error"] is None and job["capability"] == "generate"
    assert {"id", "capability", "status", "progress", "message", "result", "error"} <= set(job)
    assert job["result"]["seeds"] == [5, 6]
    assert [decode_url(u).size for u in job["result"]["images"]] == [(64, 96)] * 2
    assert any(0 < p < 1 for p in seen_progress), seen_progress
    assert seen_progress == sorted(seen_progress)


def test_job_cancel_running_and_queued(client):
    params = {"prompt": "x", "width": 64, "height": 64}
    a = client.post("/api/jobs", json={"capability": "generate", "model": "fake-slow", "params": params}).json()["id"]
    b = client.post("/api/jobs", json={"capability": "generate", "model": "fake-slow", "params": params}).json()["id"]
    wait_for(client, a, {"running"})
    job_b = client.get(f"/api/jobs/{b}").json()
    assert job_b["status"] == "queued"
    # cancel the queued job -> immediately cancelled
    r = client.delete(f"/api/jobs/{b}")
    assert r.status_code == 200 and r.json() == {"id": b, "status": "cancelled"}
    # cancel the running job -> stops at the next check
    r = client.delete(f"/api/jobs/{a}")
    assert r.status_code == 200 and r.json()["id"] == a
    job_a = wait_for(client, a, {"cancelled", "done", "error"}, timeout=5)
    assert job_a["status"] == "cancelled" and job_a["result"] is None
    assert job_a["error"]["code"] == "cancelled"
    assert job_a["progress"] < 1.0


def test_queue_full_is_busy(client):
    params = {"prompt": "x", "width": 64, "height": 64}
    ids = [client.post("/api/jobs", json={"capability": "generate", "model": "fake-slow", "params": params}).json()["id"]
           for _ in range(3)]
    r = client.post("/api/jobs", json={"capability": "generate", "model": "fake-slow", "params": params})
    assert_error(r, 429, "busy")
    for i in ids:
        client.delete(f"/api/jobs/{i}")
    wait_for(client, ids[0], {"cancelled"})


def test_classical_job_and_unload(client, synthetic_image):
    r = client.post("/api/jobs", json={"capability": "segment", "params": {
        "image": data_url(synthetic_image), "boxes": [[40, 20, 120, 100]]}})
    job = wait_for(client, r.json()["id"], {"done", "error"})
    assert job["status"] == "done" and decode_url(job["result"]["mask"]).size == (160, 120)
    # model shows as loaded, then unload
    seg = {m["id"]: m for m in client.get("/api/models").json()["capabilities"]["segment"]["models"]}
    assert seg["grabcut"]["loaded"] is True
    r = client.post("/api/models/grabcut/unload")
    assert r.status_code == 200 and r.json() == {"id": "grabcut", "loaded": False}
    seg = {m["id"]: m for m in client.get("/api/models").json()["capabilities"]["segment"]["models"]}
    assert seg["grabcut"]["loaded"] is False


def test_job_ttl_cleanup(registry):
    app = create_app(registry, job_ttl=0.05)
    with TestClient(app, base_url="http://localhost") as c:
        jid = c.post("/api/jobs", json={"capability": "generate", "model": "fake", "params": {
            "prompt": "x", "width": 64, "height": 64}}).json()["id"]
        wait_for(c, jid, {"done"})
        time.sleep(0.1)
        assert_error(c.get(f"/api/jobs/{jid}"), 404, "not_found")
