import { useCallback, useEffect, useState } from "react";

export type ThemeMode = "dark" | "light";

export interface Accent {
  key: string;
  label: string;
  /** Base colour, used for highlights, rings and primary buttons. */
  value: string;
  /** Text colour that sits legibly on `value`. */
  on: string;
}

/**
 * Accent choices. Each is checked to read clearly on the dark surfaces; `on`
 * is the text colour that meets contrast when used as a button fill.
 */
export const ACCENTS: Accent[] = [
  { key: "blue", label: "Blue", value: "#4f8ef7", on: "#06121f" },
  { key: "violet", label: "Violet", value: "#9b7cf6", on: "#120a24" },
  { key: "teal", label: "Teal", value: "#2fb8a6", on: "#04201c" },
  { key: "lime", label: "Lime", value: "#86bf3f", on: "#0d1904" },
  { key: "amber", label: "Amber", value: "#e0a33a", on: "#1e1303" },
  { key: "rose", label: "Rose", value: "#f2708c", on: "#260810" },
];

export const THEME_KEY = "label-number-generator:theme:v1";

export interface ThemePrefs {
  mode: ThemeMode;
  accent: string;
}

const DEFAULT_PREFS: ThemePrefs = { mode: "dark", accent: "blue" };

export const findAccent = (key: string): Accent =>
  ACCENTS.find((a) => a.key === key) ?? ACCENTS[0];

const loadPrefs = (): ThemePrefs => {
  try {
    const raw = localStorage.getItem(THEME_KEY);
    if (!raw) return { ...DEFAULT_PREFS };
    const parsed = JSON.parse(raw) as Partial<ThemePrefs>;
    return {
      mode: parsed?.mode === "light" ? "light" : "dark",
      accent: ACCENTS.some((a) => a.key === parsed?.accent)
        ? (parsed.accent as string)
        : DEFAULT_PREFS.accent,
    };
  } catch {
    return { ...DEFAULT_PREFS };
  }
};

/** Turn "#4f8ef7" into "79, 142, 247" so it can be used with an alpha. */
const toRgb = (hex: string): string => {
  const m = /^#([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return "79, 142, 247";
  const n = Number.parseInt(m[1], 16);
  return `${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}`;
};

export const applyTheme = ({ mode, accent }: ThemePrefs): void => {
  const root = document.documentElement;
  const picked = findAccent(accent);
  root.dataset.theme = mode;
  root.style.setProperty("--accent", picked.value);
  root.style.setProperty("--accent-soft", `rgba(${toRgb(picked.value)}, 0.16)`);
  root.style.setProperty("--accent-text", picked.on);
};

/** Editor appearance, kept apart from label designs so imports never alter it. */
export const useTheme = () => {
  const [prefs, setPrefs] = useState<ThemePrefs>(loadPrefs);

  useEffect(() => {
    applyTheme(prefs);
    try {
      localStorage.setItem(THEME_KEY, JSON.stringify(prefs));
    } catch {
      // Storage blocked: the theme still applies for this session.
    }
  }, [prefs]);

  const setMode = useCallback(
    (mode: ThemeMode) => setPrefs((p) => ({ ...p, mode })),
    []
  );
  const setAccent = useCallback(
    (accent: string) => setPrefs((p) => ({ ...p, accent })),
    []
  );
  const toggleMode = useCallback(
    () => setPrefs((p) => ({ ...p, mode: p.mode === "dark" ? "light" : "dark" })),
    []
  );

  return { prefs, setMode, setAccent, toggleMode };
};
