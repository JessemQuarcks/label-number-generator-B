/**
 * Coercion helpers used when reading designs back from localStorage or from an
 * imported JSON file. Both are outside our control, so every field is checked
 * and falls back to a sane default rather than throwing or reaching the DOM.
 */

export const asNumber = (value: unknown, fallback: number): number =>
  typeof value === "number" && Number.isFinite(value) ? value : fallback;

/** Strictly greater than zero — sizes must never be zero or negative. */
export const asPositive = (value: unknown, fallback: number): number => {
  const n = asNumber(value, Number.NaN);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

export const asNonNegative = (value: unknown, fallback: number): number => {
  const n = asNumber(value, Number.NaN);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
};

export const asInteger = (value: unknown, fallback: number, min = 0): number => {
  const n = asNumber(value, Number.NaN);
  return Number.isFinite(n) && Math.trunc(n) >= min ? Math.trunc(n) : fallback;
};

export const asString = (value: unknown, fallback: string, maxLength = 2000): string =>
  typeof value === "string" ? value.slice(0, maxLength) : fallback;

export const asBoolean = (value: unknown, fallback: boolean): boolean =>
  typeof value === "boolean" ? value : fallback;

export const asEnum = <T extends string>(
  value: unknown,
  allowed: readonly T[],
  fallback: T
): T => (allowed.includes(value as T) ? (value as T) : fallback);

/**
 * Values that end up in a React `style` object. React does not parse these, so
 * injection risk is low, but reject anything that is clearly not a plain CSS
 * value to keep imported files from producing surprising rendering.
 */
const UNSAFE_CSS = /[;{}<>]|url\s*\(|expression\s*\(|javascript:/i;

export const asCssValue = (value: unknown, fallback: string, maxLength = 120): string => {
  if (typeof value !== "string") return fallback;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > maxLength || UNSAFE_CSS.test(trimmed)) return fallback;
  return trimmed;
};

const DATA_IMAGE = /^data:image\/(png|jpe?g|gif|webp|avif|svg\+xml);base64,[A-Za-z0-9+/=\s]+$/i;
const REMOTE_IMAGE = /^https?:\/\//i;
const LOCAL_IMAGE = /^\/?[\w\-./%@()\s]+\.(png|jpe?g|gif|webp|avif|svg)$/i;

/** Only allow sources that are safe to hand to an <img src>. */
export const asImageSrc = (value: unknown, fallback = ""): string => {
  if (typeof value !== "string") return fallback;
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (DATA_IMAGE.test(trimmed)) return trimmed;
  if (REMOTE_IMAGE.test(trimmed)) return trimmed;
  if (LOCAL_IMAGE.test(trimmed)) return trimmed;
  return fallback;
};

const DATA_FONT =
  /^data:(font\/(woff2?|ttf|otf|sfnt)|application\/(x-font-)?(woff2?|ttf|otf|truetype|opentype)|application\/octet-stream);base64,[A-Za-z0-9+/=\s]+$/i;

/**
 * Only allow embedded font files. A font is fetched and executed by the font
 * engine, so unlike an image we accept data URLs exclusively — never a remote
 * URL that could change under us between preview and print.
 */
export const asFontSrc = (value: unknown, fallback = ""): string => {
  if (typeof value !== "string") return fallback;
  const trimmed = value.trim();
  if (!trimmed) return "";
  return DATA_FONT.test(trimmed) ? trimmed : fallback;
};

/**
 * A CSS font family name. Quotes and commas would let one entry smuggle in a
 * whole stack, so the name is restricted to plain characters.
 */
export const asFontFamily = (value: unknown, fallback: string): string => {
  if (typeof value !== "string") return fallback;
  const trimmed = value.trim().replace(/^["']|["']$/g, "");
  if (!trimmed || trimmed.length > 80) return fallback;
  return /^[\w\- ]+$/.test(trimmed) ? trimmed : fallback;
};

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
