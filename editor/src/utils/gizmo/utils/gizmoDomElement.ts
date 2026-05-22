import type { GizmoOptionsFallback } from "../types";
import type { NorthDirectionCompassAnchor } from "./northDirection";

export interface ViewportGizmoDomRefs {
  compass: HTMLDivElement;
  ring: HTMLDivElement;
  needle: HTMLDivElement;
  badge: HTMLDivElement;
  label: HTMLSpanElement;
}

type ViewportGizmoDomElement = HTMLDivElement & {
  __viewportGizmoRefs?: ViewportGizmoDomRefs;
};

const NORTH_COMPASS_POSITION: Record<NorthDirectionCompassAnchor, Partial<CSSStyleDeclaration>> = {
  north: {
    top: "2px",
    left: "50%",
    right: "",
    bottom: "",
    transform: "translate(-50%, -52%)",
  },
  east: {
    top: "50%",
    left: "",
    right: "2px",
    bottom: "",
    transform: "translate(52%, -50%)",
  },
  south: {
    top: "",
    left: "50%",
    right: "",
    bottom: "2px",
    transform: "translate(-50%, 52%)",
  },
  west: {
    top: "50%",
    left: "2px",
    right: "",
    bottom: "",
    transform: "translate(-52%, -50%)",
  },
};

export function setNorthCompassAnchor(
  refs: ViewportGizmoDomRefs,
  anchor: NorthDirectionCompassAnchor
) {
  const { badge, needle } = refs;
  const position = NORTH_COMPASS_POSITION[anchor];

  Object.assign(badge.style, position);
  needle.style.transform = `rotate(${anchor === "east" ? 90 : anchor === "south" ? 180 : anchor === "west" ? 270 : 0}deg)`;
}

export function getViewportGizmoDomRefs(
  domElement: HTMLElement
): ViewportGizmoDomRefs | null {
  return (domElement as ViewportGizmoDomElement).__viewportGizmoRefs ?? null;
}

export const setDomPlacement = (
  domElement: HTMLElement,
  placement: GizmoOptionsFallback["placement"]
) => {
  const [y, x] = placement.split("-");
  Object.assign(domElement.style, {
    left: x === "left" ? "0" : x === "center" ? `50%` : "",
    right: x === "right" ? "0" : "",
    top: y === "top" ? "0" : y === "bottom" ? "" : "50%",
    bottom: y === "bottom" ? "0" : "",
    transform: `${x === "center" ? "translateX(-50%)" : ""} ${
      y === "center" ? "translateY(-50%)" : ""
    }`,
  });

  return placement;
};

export const gizmoDomElement = ({
  placement,
  size,
  offset,
  id,
  className,
}: GizmoOptionsFallback) => {
  const div = document.createElement("div");

  const { top, left, right, bottom } = offset;
  Object.assign(div.style, {
    id,
    position: "absolute",
    zIndex: "1000",
    height: `${size}px`,
    width: `${size}px`,
    margin: `${top}px ${right}px ${bottom}px ${left}px`,
    borderRadius: "100%",
    overflow: "visible",
  });

  setDomPlacement(div, placement);

  if (id) div.id = id;
  if (className) div.className = className;

  const compass = document.createElement("div");
  const ring = document.createElement("div");
  const needle = document.createElement("div");
  const badge = document.createElement("div");
  const arrow = document.createElement("span");
  const label = document.createElement("span");

  Object.assign(compass.style, {
    position: "absolute",
    inset: "0",
    pointerEvents: "none",
    borderRadius: "999px",
    overflow: "visible",
  });

  Object.assign(ring.style, {
    position: "absolute",
    inset: "4px",
    borderRadius: "999px",
    border: "1px solid rgba(255, 255, 255, 0.10)",
    background:
      "radial-gradient(circle at center, rgba(255, 255, 255, 0.02), rgba(255, 255, 255, 0.01) 60%, rgba(255, 255, 255, 0) 72%)",
    boxShadow:
      "0 0 0 1px rgba(8, 12, 17, 0.20), inset 0 1px 4px rgba(255, 255, 255, 0.03)",
    backdropFilter: "none",
  });

  Object.assign(needle.style, {
    position: "absolute",
    inset: "0",
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "center",
    transformOrigin: "50% 50%",
    transform: "rotate(0deg)",
  });

  Object.assign(badge.style, {
    position: "absolute",
    display: "inline-flex",
    alignItems: "center",
    gap: "3px",
    padding: "2px 6px 1px",
    borderRadius: "999px",
    background: "rgba(10, 14, 20, 0.72)",
    border: "1px solid rgba(255, 255, 255, 0.12)",
    color: "rgba(245, 248, 252, 0.94)",
    boxShadow: "0 8px 16px rgba(0, 0, 0, 0.22)",
    letterSpacing: "0.08em",
    lineHeight: "1",
    fontSize: "9px",
    fontWeight: "700",
    textTransform: "uppercase",
    userSelect: "none",
    backdropFilter: "none",
    zIndex: "1",
  });

  Object.assign(arrow.style, {
    width: "0",
    height: "0",
    borderLeft: "3px solid transparent",
    borderRight: "3px solid transparent",
    borderBottom: "5px solid currentColor",
    opacity: "0.92",
  });

  Object.assign(label.style, {
    position: "relative",
    top: "0.5px",
  });

  label.textContent = "N";

  badge.append(arrow, label);
  needle.append(badge);
  compass.append(ring, needle);
  div.append(compass);

  (div as ViewportGizmoDomElement).__viewportGizmoRefs = {
    compass,
    ring,
    needle,
    badge,
    label,
  };

  return div;
};
