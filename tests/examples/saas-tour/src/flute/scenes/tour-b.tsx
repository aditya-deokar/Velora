import { Surface } from 'velora';
import { App, DashboardProvider } from '../../App';

export default function TourB() {
  return (
    <DashboardProvider>
      <Surface id="panel" style={{ width: 320, height: 200 }}>
        <App />
      </Surface>
      <Surface id="detail" style={{ position: 'absolute', left: 180, top: 40, width: 140, height: 120 }}>
        <div style={{ color: '#fff' }}>Detail</div>
      </Surface>
    </DashboardProvider>
  );
}
