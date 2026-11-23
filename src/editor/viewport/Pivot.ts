import type { Transform } from "../../core";
import { linearOf, round } from "./MovePlane";

/** Pivot (anchor point) math (Phase 06.3): moving the origin to a new local point writes originX/originY
 * (01.2) and compensates the position so nothing on screen moves (both changes in one batch). Pure.
 * The spatial owner maps local q to pos + offset + o + M(q - o); keeping that fixed for o → o' needs
 * pos' = pos + (o - o') - M(o - o'). */
export type Point = { x: number; y: number };
export function pivotTo(start: Transform, width: number, height: number, local: Point): Record<string, number> {
  if (!(width > 0 && height > 0)) return {};
  const o = [(((start.originX ?? 50) - 50) / 100) * width, (((start.originY ?? 50) - 50) / 100) * height];
  const originX = round(50 + (local.x / width) * 100), originY = round(50 + (local.y / height) * 100);
  const next = [((originX - 50) / 100) * width, ((originY - 50) / 100) * height];
  const d = [o[0] - next[0], o[1] - next[1]];
  const m = linearOf(start);
  const dx = d[0] - (m[0] * d[0] + m[1] * d[1]), dy = d[1] - (m[4] * d[0] + m[5] * d[1]), dz = -(m[8] * d[0] + m[9] * d[1]);
  return { originX, originY, x: round(start.x + dx), y: round(start.y + dy), ...(Math.abs(dz) > 1e-6 ? { z: round(start.z + dz) } : {}) };
}
