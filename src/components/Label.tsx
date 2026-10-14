import type { CSSProperties } from "react";
import type { Border, LabelDesign, LabelElement, Typography } from "../types";
import { PX_PER_MM } from "../lib/units";
import { formatNumber } from "../lib/numbering";

const mm = (value: number): string => `${value}mm`;

const borderToCss = (border: Border): CSSProperties =>
  border.style === "none" || border.width <= 0
    ? { borderRadius: mm(border.radius) }
    : {
        borderStyle: border.style,
        borderWidth: mm(border.width),
        borderColor: border.color,
        borderRadius: mm(border.radius),
      };

const typographyToCss = (t: Typography): CSSProperties => ({
  fontFamily: t.fontFamily,
  fontSize: `${t.fontSize}pt`,
  fontWeight: t.fontWeight,
  fontStyle: t.italic ? "italic" : "normal",
  textDecoration: t.underline ? "underline" : "none",
  color: t.color,
  textAlign: t.align,
  letterSpacing: `${t.letterSpacing}pt`,
  lineHeight: t.lineHeight,
  textTransform: t.textTransform,
  justifyContent:
    t.verticalAlign === "top"
      ? "flex-start"
      : t.verticalAlign === "bottom"
        ? "flex-end"
        : "center",
});

/** Absolute placement shared by every element type. */
const frameStyle = (el: LabelElement): CSSProperties => ({
  position: "absolute",
  left: mm(el.x),
  top: mm(el.y),
  width: mm(el.width),
  height: mm(el.height),
  transform: el.rotation ? `rotate(${el.rotation}deg)` : undefined,
  // Rotating about the centre keeps x/y meaning "where the box sits".
  transformOrigin: "center center",
  overflow: "hidden",
});

interface ElementViewProps {
  element: LabelElement;
  /** The serial number for the label this element is being drawn on. */
  number: number;
  hidePlaceholders: boolean;
}

const ElementView = ({ element, number, hidePlaceholders }: ElementViewProps) => {
  if (!element.visible) return null;
  const frame = frameStyle(element);

  switch (element.type) {
    case "text":
    case "number": {
      const text =
        element.type === "text"
          ? element.text
          : formatNumber(number, element);
      return (
        <div
          style={{
            ...frame,
            ...typographyToCss(element.typography),
            display: "flex",
            flexDirection: "column",
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
          }}
        >
          <span>{text}</span>
        </div>
      );
    }
    case "image":
      if (!element.src) {
        // An image with no source is a layout slot. Show it while designing,
        // but never let the dashed box reach paper.
        if (hidePlaceholders) return null;
        return (
          <div
            style={{
              ...frame,
              border: "0.3mm dashed #9ca3af",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "#9ca3af",
              fontSize: "7pt",
              fontFamily: "system-ui, sans-serif",
              boxSizing: "border-box",
            }}
          >
            {element.name}
          </div>
        );
      }
      return (
        <img
          src={element.src}
          alt={element.name}
          style={{ ...frame, objectFit: element.fit }}
        />
      );
    case "shape":
      return (
        <div
          style={{
            ...frame,
            backgroundColor: element.fill,
            ...borderToCss(element.border),
            boxSizing: "border-box",
          }}
        />
      );
  }
};

export interface LabelProps {
  design: LabelDesign;
  number: number;
  /** 1 = true physical size. The editor canvas scales this to fit. */
  scale?: number;
  /** Hide dashed placeholders for images with no source (used when printing). */
  hidePlaceholders?: boolean;
  className?: string;
}

/**
 * Renders one label at its true physical size. Everything inside is positioned
 * in millimetres, so what prints matches what the design specifies; `scale`
 * only shrinks the rendered result visually.
 */
const Label = ({
  design,
  number,
  scale = 1,
  hidePlaceholders = false,
  className,
}: LabelProps) => {
  const hasBorder = design.border.style !== "none" && design.border.width > 0;

  const inner = (
    <div
      className={className}
      style={{
        position: "relative",
        width: mm(design.width),
        height: mm(design.height),
        backgroundColor: design.background,
        borderRadius: mm(design.border.radius),
        overflow: "hidden",
      }}
    >
      {design.elements.map((element) => (
        <ElementView
          key={element.id}
          element={element}
          number={number}
          hidePlaceholders={hidePlaceholders}
        />
      ))}
      {/* The border is drawn as an inset overlay rather than a CSS border on
          the label box, so the label keeps its exact declared physical size
          and element coordinates stay measured from the true edge. */}
      {hasBorder && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            ...borderToCss(design.border),
            boxSizing: "border-box",
            pointerEvents: "none",
          }}
        />
      )}
    </div>
  );

  if (scale === 1) return inner;

  // Reserve the scaled footprint so surrounding layout does not overlap.
  return (
    <div
      style={{
        width: design.width * PX_PER_MM * scale,
        height: design.height * PX_PER_MM * scale,
      }}
    >
      <div style={{ transform: `scale(${scale})`, transformOrigin: "top left" }}>
        {inner}
      </div>
    </div>
  );
};

export default Label;
