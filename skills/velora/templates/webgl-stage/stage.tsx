export function Stage({ timeMs, seed }: { timeMs: number; seed: number }) {
  const angle = (timeMs / 1000) * 0.6 + seed * 0.0001;
  return <canvas data-webgl-stage={angle.toFixed(4)} width={640} height={480} />;
}
