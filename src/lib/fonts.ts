/**
 * Font stacks offered in the inspector. These are deliberately limited to
 * families that ship with Windows/macOS so a design prints the same way it
 * previews, without a webfont round-trip.
 */
export interface FontOption {
  label: string;
  value: string;
}

export const FONT_OPTIONS: FontOption[] = [
  { label: "Arial / Helvetica", value: "Arial, Helvetica, sans-serif" },
  { label: "Segoe UI", value: "'Segoe UI', Tahoma, sans-serif" },
  { label: "Verdana", value: "Verdana, Geneva, sans-serif" },
  { label: "Tahoma", value: "Tahoma, Verdana, sans-serif" },
  { label: "Trebuchet MS", value: "'Trebuchet MS', Tahoma, sans-serif" },
  { label: "Calibri", value: "Calibri, 'Segoe UI', sans-serif" },
  { label: "Impact (condensed)", value: "Impact, 'Arial Narrow Bold', sans-serif" },
  { label: "Georgia (serif)", value: "Georgia, 'Times New Roman', serif" },
  { label: "Times New Roman (serif)", value: "'Times New Roman', Times, serif" },
  { label: "Garamond (serif)", value: "Garamond, Georgia, serif" },
  { label: "Palatino (serif)", value: "'Palatino Linotype', Palatino, serif" },
  { label: "Courier New (mono)", value: "'Courier New', Courier, monospace" },
  { label: "Consolas (mono)", value: "Consolas, 'Courier New', monospace" },
  { label: "Brush Script (handwriting)", value: "'Brush Script MT', 'Segoe Script', cursive" },
  { label: "Segoe Script (handwriting)", value: "'Segoe Script', 'Brush Script MT', cursive" },
];

export const FONT_WEIGHTS = [
  { label: "300 — Light", value: 300 },
  { label: "400 — Regular", value: 400 },
  { label: "500 — Medium", value: 500 },
  { label: "600 — Semibold", value: 600 },
  { label: "700 — Bold", value: 700 },
  { label: "800 — Extrabold", value: 800 },
  { label: "900 — Black", value: 900 },
];
