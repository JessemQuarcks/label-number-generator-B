import type { ReactNode } from "react";

/** A 16px stroke icon in the current text colour. */
const Svg = ({ children, size = 16 }: { children: ReactNode; size?: number }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.4}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    focusable="false"
  >
    {children}
  </svg>
);

export type IconName =
  | "move"
  | "hand"
  | "zoom"
  | "zoomOut"
  | "text"
  | "number"
  | "shape"
  | "crop"
  | "image"
  | "alignLeft"
  | "alignHCenter"
  | "alignRight"
  | "alignTop"
  | "alignVCenter"
  | "alignBottom"
  | "alignCenter"
  | "distributeH"
  | "distributeV"
  | "eye"
  | "eyeOff"
  | "close"
  | "chevron"
  | "more"
  | "up"
  | "down"
  | "trash"
  | "copy"
  | "check"
  | "plus"
  | "layers"
  | "sliders"
  | "flipH"
  | "flipV"
  | "fit"
  | "undo"
  | "redo"
  | "warning"
  | "folder"
  | "folderOpen"
  | "folderPlus"
  | "newLayer"
  | "fx"
  | "brush"
  | "eraser"
  | "pixels"
  | "swap"
  | "ellipse"
  | "triangle"
  | "polygon"
  | "star"
  | "line"
  | "arrow"
  | "heart"
  | "speech"
  | "burst"
  | "cross"
  | "drop"
  | "grip"
  | "marqueeRect"
  | "marqueeEllipse"
  | "lasso"
  | "lassoPoly"
  | "objectSelect"
  | "quickSelect"
  | "magicWand"
  | "remove"
  | "sparkle"
  | "mask"
  | "subject"
  | "invertSelection"
  | "refine"
  | "deselect"
  | "expand"
  | "server";

const PATHS: Record<IconName, ReactNode> = {
  move: <path d="M3 2.5l9 4-3.8 1.3L6.9 11.7z M8.3 8.1l3.4 3.4" />,
  hand: (
    <path d="M5 8V3.6a1 1 0 012 0V7.5 M7 7V2.6a1 1 0 012 0V7 M9 7V3.4a1 1 0 012 0V8.5 M11 6.4a1 1 0 012 0V9.5c0 2.5-1.8 4.5-4.4 4.5-1.6 0-2.7-.7-3.6-2L3.2 9.2a1 1 0 011.6-1.2L5 8.3" />
  ),
  zoom: (
    <>
      <circle cx="7" cy="7" r="4.5" />
      <path d="M10.4 10.4L14 14 M5 7h4 M7 5v4" />
    </>
  ),
  zoomOut: (
    <>
      <circle cx="7" cy="7" r="4.5" />
      <path d="M10.4 10.4L14 14 M5 7h4" />
    </>
  ),
  text: <path d="M3 3.5h10 M8 3.5V13 M6 13h4" />,
  number: <path d="M6 2.5L4.8 13.5 M11.2 2.5L10 13.5 M2.8 6h11 M2.2 10h11" />,
  shape: <rect x="2.5" y="3.5" width="11" height="9" rx="1" />,
  crop: <path d="M4 1.5V12h10.5 M1.5 4H12v10.5" />,
  image: (
    <>
      <rect x="2" y="3" width="12" height="10" rx="1.2" />
      <circle cx="5.8" cy="6.5" r="1.1" />
      <path d="M2.5 11.5l3.5-3 2.5 2 2-1.5 3 2.5" />
    </>
  ),
  alignLeft: <path d="M2.5 2v12 M5 4.5h8v2.5H5z M5 9h5v2.5H5z" />,
  alignHCenter: <path d="M8 2v12 M3.5 4.5h9v2.5h-9z M5.5 9h5v2.5h-5z" />,
  alignRight: <path d="M13.5 2v12 M3 4.5h8v2.5H3z M6 9h5v2.5H6z" />,
  alignTop: <path d="M2 2.5h12 M4.5 5h2.5v8H4.5z M9 5h2.5v5H9z" />,
  alignVCenter: <path d="M2 8h12 M4.5 3.5h2.5v9H4.5z M9 5.5h2.5v5H9z" />,
  alignBottom: <path d="M2 13.5h12 M4.5 3h2.5v8H4.5z M9 6h2.5v5H9z" />,
  alignCenter: (
    <>
      <rect x="4.5" y="4.5" width="7" height="7" rx="0.5" />
      <path d="M8 1.5v3 M8 11.5v3 M1.5 8h3 M11.5 8h3" />
    </>
  ),
  distributeH: <path d="M2 2v12 M14 2v12 M6 5h4v6H6z" />,
  distributeV: <path d="M2 2h12 M2 14h12 M5 6h6v4H5z" />,
  eye: (
    <>
      <path d="M1.5 8s2.4-4.5 6.5-4.5S14.5 8 14.5 8 12.1 12.5 8 12.5 1.5 8 1.5 8z" />
      <circle cx="8" cy="8" r="2" />
    </>
  ),
  eyeOff: (
    <path d="M2 2l12 12 M6.6 4A6.3 6.3 0 018 3.5C12.1 3.5 14.5 8 14.5 8a11 11 0 01-1.8 2.4 M10.2 10.9A5.6 5.6 0 018 12.5C3.9 12.5 1.5 8 1.5 8a11.5 11.5 0 012.6-3" />
  ),
  close: <path d="M4 4l8 8 M12 4l-8 8" />,
  chevron: <path d="M6 4l4 4-4 4" />,
  more: (
    <>
      <circle cx="3.5" cy="8" r="0.6" fill="currentColor" />
      <circle cx="8" cy="8" r="0.6" fill="currentColor" />
      <circle cx="12.5" cy="8" r="0.6" fill="currentColor" />
    </>
  ),
  up: <path d="M8 13V3 M4 7l4-4 4 4" />,
  down: <path d="M8 3v10 M4 9l4 4 4-4" />,
  trash: <path d="M3 4.5h10 M6.5 4.5V3h3v1.5 M4.5 4.5l.6 9h5.8l.6-9" />,
  copy: (
    <>
      <rect x="5" y="5" width="8.5" height="8.5" rx="1" />
      <path d="M11 5V3.5a1 1 0 00-1-1H3.5a1 1 0 00-1 1V10a1 1 0 001 1H5" />
    </>
  ),
  check: <path d="M3 8.5l3 3 7-7" />,
  plus: <path d="M8 3v10 M3 8h10" />,
  layers: <path d="M8 2l6 3.2-6 3.2-6-3.2z M2 8.2l6 3.2 6-3.2 M2 11l6 3.2 6-3.2" />,
  sliders: (
    <path d="M3 3v10 M8 3v10 M13 3v10 M1.5 10h3 M6.5 5.5h3 M11.5 9h3" />
  ),
  flipH: <path d="M8 1.5v13 M6 4L2 12h4z M10 4l4 8h-4z" />,
  flipV: <path d="M1.5 8h13 M4 6l8-4v4z M4 10l8 4v-4z" />,
  fit: <path d="M2 5.5V2h3.5 M10.5 2H14v3.5 M14 10.5V14h-3.5 M5.5 14H2v-3.5" />,
  undo: <path d="M5 3L2 6l3 3 M2 6h7.5a4 4 0 010 8H6" />,
  redo: <path d="M11 3l3 3-3 3 M14 6H6.5a4 4 0 000 8H10" />,
  warning: <path d="M8 2l6.5 11.5h-13z M8 6.5v3 M8 11.6v.1" />,
  folder: <path d="M1.5 4.5a1 1 0 011-1h3.2l1.4 1.5h6.4a1 1 0 011 1v6.5a1 1 0 01-1 1h-11a1 1 0 01-1-1z" />,
  folderOpen: (
    <path d="M1.5 12V4.5a1 1 0 011-1h3.2l1.4 1.5H12a1 1 0 011 1v1 M1.5 12l2-5h11l-2 5.5h-10a1 1 0 01-1-.5z" />
  ),
  folderPlus: (
    <path d="M1.5 4.5a1 1 0 011-1h3.2l1.4 1.5h6.4a1 1 0 011 1v6.5a1 1 0 01-1 1h-11a1 1 0 01-1-1z M8 7v4 M6 9h4" />
  ),
  newLayer: <path d="M3 2.5h6.5L13 6v7.5H3z M9.5 2.5V6H13 M8 8v4 M6 10h4" />,
  fx: <path d="M3.5 13l1.6-8.2c.3-1.4 1-2.3 2.4-2.3 M3 7h4 M8.5 7.5l4 5 M12.5 7.5l-4 5" />,
  brush: (
    <path d="M13.5 2.5L7.2 8.8 M8.6 10.2l5-5.3-2.6-2.4-5.2 5.1z M7.2 8.8C5 8.3 3.6 9.6 3.4 11.4c-.2 1.3-.9 1.8-1.9 2.1 3 .9 5.6.3 6.6-1.4.5-.9.4-1.9-.1-2.6" />
  ),
  eraser: <path d="M6 13.5h7.5 M2.7 9.6l6.6-6.6a1 1 0 011.4 0l2.6 2.6a1 1 0 010 1.4L7.2 13.1a1 1 0 01-.7.4H5a1 1 0 01-.7-.3L2.7 11a1 1 0 010-1.4z M5.5 6.8l4 4" />,
  pixels: (
    <>
      <rect x="2" y="2" width="12" height="12" rx="1" />
      <path d="M2 6h12 M2 10h12 M6 2v12 M10 2v12" />
    </>
  ),
  swap: <path d="M4 3v7.5a1.5 1.5 0 001.5 1.5H12 M10 10l2 2-2 2 M12 6V4.5A1.5 1.5 0 0010.5 3H8 M6 1l-2 2 2 2" />,
  ellipse: <ellipse cx="8" cy="8" rx="6" ry="4.5" />,
  triangle: <path d="M8 2.5l6 11H2z" />,
  polygon: <path d="M8 2l5.2 3v6L8 14l-5.2-3V5z" />,
  star: <path d="M8 1.8l1.9 3.9 4.3.6-3.1 3 .7 4.3L8 11.6l-3.8 2 .7-4.3-3.1-3 4.3-.6z" />,
  line: <path d="M2.5 13.5l11-11" />,
  arrow: <path d="M1.5 6h7V3l5.5 5-5.5 5v-3h-7z" />,
  heart: (
    <path d="M8 13.5S2 10 2 6a3 3 0 015.4-1.8L8 5l.6-.8A3 3 0 0114 6c0 4-6 7.5-6 7.5z" />
  ),
  speech: <path d="M2.5 3h11a1 1 0 011 1v6a1 1 0 01-1 1H7l-3 2.5V11H2.5a1 1 0 01-1-1V4a1 1 0 011-1z" />,
  burst: (
    <path d="M8 1.5l1.4 2 2.4-.6.3 2.4 2.3 1-1.2 2.1 1.2 2.1-2.3 1-.3 2.4-2.4-.6L8 15.3l-1.4-2-2.4.6-.3-2.4-2.3-1L2.8 8.4 1.6 6.3l2.3-1 .3-2.4 2.4.6z" />
  ),
  cross: <path d="M6 2h4v4h4v4h-4v4H6v-4H2V6h4z" />,
  drop: <path d="M8 1.8S3.5 7 3.5 10a4.5 4.5 0 009 0C12.5 7 8 1.8 8 1.8z" />,
  grip: (
    <>
      <circle cx="6" cy="4" r="0.7" fill="currentColor" />
      <circle cx="10" cy="4" r="0.7" fill="currentColor" />
      <circle cx="6" cy="8" r="0.7" fill="currentColor" />
      <circle cx="10" cy="8" r="0.7" fill="currentColor" />
      <circle cx="6" cy="12" r="0.7" fill="currentColor" />
      <circle cx="10" cy="12" r="0.7" fill="currentColor" />
    </>
  ),
  marqueeRect: <rect x="2.5" y="3.5" width="11" height="9" strokeDasharray="2 1.6" />,
  marqueeEllipse: <ellipse cx="8" cy="8" rx="5.8" ry="4.6" strokeDasharray="2 1.6" />,
  lasso: (
    <path d="M5 11.5C2.6 10.6 1.8 8.6 2.6 6.6 3.6 4 7 2.6 10 3.1c2.8.5 4.1 2.6 3.3 4.7-.9 2.3-4.2 3.4-7.2 3.1 M5 11.5c-.4 1.4.4 2.4 1.6 2.6" />
  ),
  lassoPoly: <path d="M3 12l1.5-8 6-1.5 3 5-4 4.5z M3 12l-.8 2" strokeDasharray="2 1.4" />,
  objectSelect: (
    <>
      <rect x="2" y="2" width="12" height="12" rx="1" strokeDasharray="2 1.6" />
      <path d="M6 10.5c0-2 1-4.5 2.5-4.5S11 8 11 10.5z" />
    </>
  ),
  quickSelect: (
    <>
      <path d="M9.5 2.5l4 4-5.5 5.5-4-4z M4 8l-1.6 1.6c-.6.6-.6 1.6 0 2.2l1.8 1.8c.6.6 1.6.6 2.2 0L8 12" />
      <circle cx="3" cy="3" r="1.2" strokeDasharray="1.2 1" />
    </>
  ),
  magicWand: (
    <path d="M2.5 13.5l7-7 M8.5 5.5l2 2 M11 1.5v2 M13.5 4.5h-2 M13 2l-1.4 1.4 M8.5 1.8l.6 1.2 M14.2 7l-1.2-.6" />
  ),
  remove: (
    <>
      <path d="M3.2 9.2l6-6a2 2 0 012.8 0l.8.8a2 2 0 010 2.8l-6 6a2 2 0 01-2.8 0l-.8-.8a2 2 0 010-2.8z" />
      <path d="M6.5 6.5l3 3 M7.8 8.2h.1 M6.8 9.4h.1 M9 7h.1" />
    </>
  ),
  sparkle: (
    <path d="M7 1.8l1.2 3.5 3.5 1.2-3.5 1.2L7 11.2 5.8 7.7 2.3 6.5l3.5-1.2z M12.3 9.5l.6 1.6 1.6.6-1.6.6-.6 1.6-.6-1.6-1.6-.6 1.6-.6z" />
  ),
  mask: (
    <>
      <rect x="2" y="3" width="12" height="10" rx="1.2" />
      <circle cx="8" cy="8" r="3" fill="currentColor" fillOpacity={0.35} />
    </>
  ),
  subject: (
    <>
      <rect x="1.8" y="1.8" width="12.4" height="12.4" rx="1" strokeDasharray="2 1.6" />
      <circle cx="8" cy="6" r="2" />
      <path d="M4.5 12.5c.4-2.2 1.8-3.4 3.5-3.4s3.1 1.2 3.5 3.4" />
    </>
  ),
  invertSelection: (
    <>
      <rect x="2" y="2" width="12" height="12" rx="1" />
      <path d="M2 14L14 2" />
      <path d="M2.5 13.5L2 2h12z" fill="currentColor" fillOpacity={0.3} stroke="none" />
    </>
  ),
  refine: <path d="M2.5 13.5c2-1 3-3 3.6-5.2C6.8 5.6 8.6 3 11 2.5 M7 13.5c1.5-1 2.4-2.6 3-4.4.5-1.6 1.6-3 3.5-3.6 M2.5 9.5c1.6-.6 2.6-2 3.1-3.6" />,
  deselect: (
    <>
      <rect x="2.5" y="3.5" width="11" height="9" strokeDasharray="2 1.6" />
      <path d="M6 6l4 4 M10 6l-4 4" />
    </>
  ),
  expand: <path d="M5.5 5.5h5v5h-5z M2 6V2h4 M10 2h4v4 M14 10v4h-4 M6 14H2v-4" />,
  server: (
    <>
      <rect x="2.5" y="2.5" width="11" height="4.5" rx="1" />
      <rect x="2.5" y="9" width="11" height="4.5" rx="1" />
      <path d="M5 4.8h.1 M5 11.3h.1" />
    </>
  ),
};


export const Icon = ({ name, size }: { name: IconName; size?: number }) => (
  <Svg size={size}>{PATHS[name]}</Svg>
);
