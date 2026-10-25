import { Surface } from '@adityadeokar/velora';

// Bars rise on a fixed stagger (seed 99 recorded in story.composition.json).
// Replace the heights with real series data; keep the stagger deterministic.
export default function Growth() {
  return (
    <>
      <Surface id="bar-a" style={{ width: 80, height: 120, background: '#e8ecf1' }}>
        <div style={{ color: '#111' }}>Q1</div>
      </Surface>
      <Surface id="bar-b" style={{ width: 80, height: 120, background: '#d7e3ee' }}>
        <div style={{ color: '#111' }}>Q2</div>
      </Surface>
      <Surface id="bar-c" style={{ width: 80, height: 120, background: '#c9d6e4' }}>
        <div style={{ color: '#111' }}>Q3</div>
      </Surface>
    </>
  );
}
