import { describe, expect, it } from "vitest";
import { defaultWorkspace, DOCK_MAX, DOCK_MIN, normalizeWorkspace } from "./workspace";

describe("workspace preferences", () => {
  it("falls back to defaults for anything missing or malformed", () => {
    expect(normalizeWorkspace(null)).toEqual(defaultWorkspace());
    expect(normalizeWorkspace("junk")).toEqual(defaultWorkspace());
  });

  it("keeps a closed panel closed and a moved panel where it was put", () => {
    const ws = normalizeWorkspace({
      panels: { layers: { visible: false, collapsed: false, dock: "right" } },
    });
    expect(ws.panels.layers).toEqual({ visible: false, collapsed: false, dock: "right" });
    expect(ws.panels.properties).toEqual(defaultWorkspace().panels.properties);
  });

  it("clamps dock widths", () => {
    const ws = normalizeWorkspace({ dockWidth: { left: 5, right: 99999 } });
    expect(ws.dockWidth).toEqual({ left: DOCK_MIN, right: DOCK_MAX });
  });

  it("keeps every panel in the order list, even if the stored one is partial", () => {
    const ws = normalizeWorkspace({ panelOrder: ["print", "bogus"] });
    expect(ws.panelOrder[0]).toBe("print");
    expect([...ws.panelOrder].sort()).toEqual(["brush", "fonts", "layers", "print", "properties"]);
  });

  it("rejects tool defaults that are not plain colours or sane sizes", () => {
    const ws = normalizeWorkspace({
      toolDefaults: { text: { color: "url(evil)", fontSize: -4 }, shape: { fill: "#123456" } },
    });
    expect(ws.toolDefaults.text.color).toBe("#000000");
    expect(ws.toolDefaults.text.fontSize).toBe(1);
    expect(ws.toolDefaults.shape.fill).toBe("#123456");
  });
});
