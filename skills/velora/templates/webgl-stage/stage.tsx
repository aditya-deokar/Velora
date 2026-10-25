import { Surface, WebGLSurface, useSceneTime } from '@adityadeokar/velora';

// Time-disciplined WebGL leaf: the canvas paints a pure function of scene time and
// seed on every seek. It owns no animation loop or ticker clock, so frames replay exactly.
export default function Stage() {
  const timeMs = useSceneTime();
  return (
    <Surface id="gl" style={{ width: 1280, height: 720 }}>
      <WebGLSurface
        timeMs={timeMs}
        scene={{ seed: 7, width: 1280, height: 720 }}
        style={{ width: 1280, height: 720 }}
        fallback={<div style={{ width: 1280, height: 720, background: '#101018' }} />}
        render={(gl, { t, seed }) => {
          const phase = (t / 2000 + seed / 100) % 1;
          gl.clearColor(0.06 + 0.3 * phase, 0.08, 0.2 + 0.25 * (1 - phase), 1);
          gl.clear(gl.COLOR_BUFFER_BIT);
        }}
      />
    </Surface>
  );
}
