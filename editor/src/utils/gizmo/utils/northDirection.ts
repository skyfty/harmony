import type { EnvironmentNorthDirection } from "@/types/environment";

export const DEFAULT_NORTH_DIRECTION: EnvironmentNorthDirection = "+X";

const NORTH_DIRECTION_ANGLE_DEGREES: Record<EnvironmentNorthDirection, number> = {
  "+X": 0,
  "-X": 180,
  "+Z": 90,
  "-Z": 270,
};

export type NorthDirectionCompassAnchor = "north" | "east" | "south" | "west";

export function resolveNorthDirectionAngleDegrees(
  direction: EnvironmentNorthDirection | null | undefined
): number {
  return NORTH_DIRECTION_ANGLE_DEGREES[direction ?? DEFAULT_NORTH_DIRECTION];
}

export function resolveNorthDirectionCompassAnchor(
  direction: EnvironmentNorthDirection | null | undefined
): NorthDirectionCompassAnchor {
  switch (direction ?? DEFAULT_NORTH_DIRECTION) {
    case "+X":
      return "east";
    case "-X":
      return "west";
    case "+Z":
      return "north";
    case "-Z":
    default:
      return "south";
  }
}
