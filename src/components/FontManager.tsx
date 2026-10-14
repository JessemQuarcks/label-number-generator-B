import { useRef, useState } from "react";
import type { CustomFont } from "../types";
import { IconButton } from "./controls";
import { newId } from "../lib/units";
import { MAX_FONTS } from "../lib/storage";

/** Font files browsers can actually use. */
const ACCEPTED = ".woff2,.woff,.ttf,.otf";

const MIME_BY_EXT: Record<string, string> = {
  woff2: "font/woff2",
  woff: "font/woff",
  ttf: "font/ttf",
  otf: "font/otf",
};

/** Derive a usable family name from the file name. */
const familyFromFile = (name: string): string =>
  name
    .replace(/\.[^.]+$/, "")
    .replace(/[_-]+/g, " ")
    .replace(/[^\w ]/g, "")
    .trim()
    .slice(0, 60) || "Custom font";

interface FontManagerProps {
  fonts: CustomFont[];
  onAdd: (font: CustomFont) => void;
  onRemove: (id: string) => void;
  onError: (message: string) => void;
}

/**
 * Uploads font files into the active design. Files are stored as data URLs, so
 * they survive reloads and travel with an export — the same approach used for
 * uploaded images.
 */
const FontManager = ({ fonts, onAdd, onRemove, onError }: FontManagerProps) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const atLimit = fonts.length >= MAX_FONTS;

  const handleFiles = async (files: FileList) => {
    setBusy(true);
    try {
      for (const file of Array.from(files)) {
        const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
        const mime = MIME_BY_EXT[ext];
        if (!mime) {
          onError(`${file.name}: not a font file.`);
          continue;
        }
        // A font is embedded in every saved copy of the design, so a very
        // large file would bloat storage past the browser's quota.
        if (file.size > 2 * 1024 * 1024) {
          onError(`${file.name}: larger than 2MB.`);
          continue;
        }

        const src = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () =>
            typeof reader.result === "string"
              ? resolve(reader.result)
              : reject(new Error("unreadable"));
          reader.onerror = () => reject(new Error("unreadable"));
          reader.readAsDataURL(file);
        }).catch(() => null);

        if (!src) {
          onError(`${file.name}: could not be read.`);
          continue;
        }

        // FileReader labels unknown types as octet-stream; normalise to the
        // real font MIME so the stored URL is self-describing.
        const normalised = src.replace(
          /^data:[^;]*;base64,/,
          `data:${mime};base64,`
        );

        onAdd({
          id: newId(),
          family: familyFromFile(file.name),
          src: normalised,
          weight: "normal",
          style: "normal",
        });
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-2">
      {fonts.length > 0 && (
        <ul className="flex flex-col gap-0.5">
          {fonts.map((font) => (
            <li
              key={font.id}
              className="group flex items-center gap-2 rounded-[var(--radius)] px-1.5 py-1 text-[11px] text-[var(--text-dim)] hover:bg-[var(--surface-3)]"
            >
              <span
                className="min-w-0 flex-1 truncate"
                style={{ fontFamily: `"${font.family}", sans-serif` }}
                title={font.family}
              >
                {font.family}
              </span>
              <IconButton
                danger
                title={`Remove ${font.family}`}
                onClick={() => onRemove(font.id)}
              >
                ✕
              </IconButton>
            </li>
          ))}
        </ul>
      )}

      <label
        className={`flex items-center justify-center gap-2 rounded-[var(--radius)] border border-dashed px-3 py-2.5 text-[11px] transition-colors ${
          atLimit || busy
            ? "cursor-not-allowed border-[var(--border)] text-[var(--text-faint)]"
            : "cursor-pointer border-[var(--border-strong)] text-[var(--text-dim)] hover:border-[var(--accent)] hover:text-[var(--accent)]"
        }`}
      >
        <span aria-hidden="true">↥</span>
        {busy ? "Reading…" : atLimit ? `Limit ${MAX_FONTS} fonts` : "Upload font"}
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPTED}
          multiple
          disabled={atLimit || busy}
          className="sr-only"
          onChange={(event) => {
            const files = event.target.files;
            if (files?.length) void handleFiles(files);
            event.target.value = "";
          }}
        />
      </label>

      <p className="text-[11px] leading-snug text-[var(--text-faint)]">
        .woff2, .woff, .ttf or .otf. Embedded in the design, and loaded before
        the label renders or prints.
      </p>
    </div>
  );
};

export default FontManager;
