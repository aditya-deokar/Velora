/** The ruler: adaptive ticks (at least 60 px apart), markers, work area and playhead. Times are presentation ms. */
export const TICK_STEPS = [10, 20, 50, 100, 250, 500, 1000, 2000, 5000, 10000, 30000, 60000];
export function tickStep(pxPerMs: number, minPx = 60): number {
  return TICK_STEPS.find(step => step * pxPerMs >= minPx) ?? TICK_STEPS[TICK_STEPS.length - 1];
}
export function Ruler({ width, start, pxPerMs, durationMs, markers, workArea, playhead }: { width: number; start: number; pxPerMs: number; durationMs: number;
  markers: { time: number; label: string; index: number }[]; workArea?: { startMs: number; endMs: number }; playhead: number }) {
  const step = tickStep(pxPerMs);
  const first = Math.floor(start / step) * step;
  const ticks: number[] = [];
  for (let t = first; (t - start) * pxPerMs <= width; t += step) if (t >= 0 && t <= durationMs) ticks.push(t);
  const x = (time: number) => (time - start) * pxPerMs;
  return <g data-ruler="">
    <rect x={0} y={0} width={width} height={24} fill="#141417"/>
    {workArea && <rect data-work-area="" x={x(workArea.startMs)} y={0} width={Math.max(0, (workArea.endMs - workArea.startMs) * pxPerMs)} height={24} fill="#7cc4ff33"/>}
    {ticks.map(t => <g key={t}><line x1={x(t)} x2={x(t)} y1={14} y2={24} stroke="#ffffff55"/>
      <text x={x(t) + 3} y={11} fontSize={10} fill="#a9a9b6">{`${Number((t / 1000).toFixed(step % 1000 === 0 ? 0 : step % 100 === 0 ? 1 : 2))}s`}</text></g>)}
    <line x1={x(durationMs)} x2={x(durationMs)} y1={0} y2={24} stroke="#ff6b6b88"/>
    {markers.map(marker => <g key={marker.index} data-marker={marker.index}><path d={`M${x(marker.time) - 5} 14L${x(marker.time) + 5} 14L${x(marker.time)} 22Z`} fill="#b893ff"/>
      <title>{marker.label}</title></g>)}
    <path d={`M${x(playhead) - 6} 0H${x(playhead) + 6}L${x(playhead)} 10Z`} fill="#ff8a3d"/>
  </g>;
}
