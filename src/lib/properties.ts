import type { LabelElement } from "../types";
import type { IconName } from "../components/icons";

/* -------------------------------------------------------------------------
 * Categories
 * ---------------------------------------------------------------------- */

export type PropertiesKind = "document" | "multi" | "group" | LabelElement["type"];

export type CategoryId =
  | "document"
  | "background"
  | "docBorder"
  | "layer"
  | "arrange"
  | "text"
  | "numbering"
  | "character"
  | "paragraph"
  | "image"
  | "effects"
  | "shape"
  | "fill"
  | "border"
  | "group";

export interface Category {
  id: CategoryId;
  label: string;
  icon: IconName;
}

const CATEGORIES: Record<PropertiesKind, Category[]> = {
  document: [
    { id: "document", label: "Size", icon: "fit" },
    { id: "background", label: "Background", icon: "shape" },
    { id: "docBorder", label: "Border", icon: "shape" },
  ],
  multi: [{ id: "arrange", label: "Arrange", icon: "alignLeft" }],
  group: [
    { id: "group", label: "Group", icon: "folder" },
    { id: "arrange", label: "Arrange", icon: "alignHCenter" },
  ],
  text: [
    { id: "text", label: "Text", icon: "text" },
    { id: "character", label: "Character", icon: "text" },
    { id: "paragraph", label: "Paragraph", icon: "alignLeft" },
    { id: "layer", label: "Layer", icon: "layers" },
    { id: "arrange", label: "Arrange", icon: "alignHCenter" },
  ],
  number: [
    { id: "numbering", label: "Numbering", icon: "number" },
    { id: "character", label: "Character", icon: "text" },
    { id: "paragraph", label: "Paragraph", icon: "alignLeft" },
    { id: "layer", label: "Layer", icon: "layers" },
    { id: "arrange", label: "Arrange", icon: "alignHCenter" },
  ],
  image: [
    { id: "image", label: "Image", icon: "image" },
    { id: "effects", label: "Effects", icon: "fx" },
    { id: "layer", label: "Layer", icon: "layers" },
    { id: "arrange", label: "Arrange", icon: "alignHCenter" },
  ],
  shape: [
    { id: "shape", label: "Shape", icon: "shape" },
    { id: "fill", label: "Fill", icon: "shape" },
    { id: "border", label: "Stroke", icon: "shape" },
    { id: "layer", label: "Layer", icon: "layers" },
    { id: "arrange", label: "Arrange", icon: "alignHCenter" },
  ],
  raster: [
    { id: "layer", label: "Layer", icon: "layers" },
    { id: "effects", label: "Effects", icon: "fx" },
    { id: "arrange", label: "Arrange", icon: "alignHCenter" },
  ],
};

export const categoriesFor = (kind: PropertiesKind): Category[] => CATEGORIES[kind];

/** The category a selection opens on, unless the user picked another before. */
export const resolveCategory = (kind: PropertiesKind, remembered?: string): CategoryId => {
  const list = CATEGORIES[kind];
  return (list.find((c) => c.id === remembered)?.id ?? list[0].id) as CategoryId;
};

export const kindOf = (
  selectedCount: number,
  selected: LabelElement | null,
  groupSelected = false
): PropertiesKind =>
  selectedCount > 1 ? "multi" : groupSelected ? "group" : selected ? selected.type : "document";
