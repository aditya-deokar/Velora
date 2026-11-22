export type Matrix = readonly number[];
export type Vec3 = [number, number, number];

export const applyPoint = (m: Matrix, [x, y, z]: readonly number[]): Vec3 =>
  [m[0] * x + m[1] * y + m[2] * z + m[3], m[4] * x + m[5] * y + m[6] * z + m[7], m[8] * x + m[9] * y + m[10] * z + m[11]];
