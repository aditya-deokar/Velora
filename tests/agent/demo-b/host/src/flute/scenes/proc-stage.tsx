import { Surface } from 'velora';

// Time-disciplined WebGL-style leaf: a pure function of video time plus seed.
// No requestAnimationFrame, no ticker, no wall clock.
export function GlStage({ timeMs, seed }: { timeMs: number; seed: number }) {
  const angle = (timeMs / 1000) * 0.6 + seed * 0.0001;
  return <canvas data-gl-stage={angle.toFixed(4)} width={320} height={200} />;
}

export default function ProcStage() {
  return (
    <>
      <Surface id="orb-a" style={{ width: 140, height: 140, background: '#e8ecf1' }}>
        <div style={{ color: '#111', fontSize: 64 }}>A</div>
      </Surface>
      <Surface id="orb-b" style={{ width: 140, height: 140, background: '#d7e3ee' }}>
        <div style={{ color: '#111', fontSize: 64 }}>B</div>
      </Surface>
      <Surface id="orb-c" style={{ width: 140, height: 140, background: '#c9d6e4' }}>
        <GlStage timeMs={0} seed={42} />
      </Surface>
    </>
  );
}
