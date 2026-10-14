import { Surface } from 'velora';
import { App, DashboardProvider } from '../../App';

export default function TeaserA() {
  return (
    <DashboardProvider>
      <Surface id="page" style={{ width: 320, height: 200 }}>
        <App />
      </Surface>
    </DashboardProvider>
  );
}
