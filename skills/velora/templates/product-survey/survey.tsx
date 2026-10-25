import { Surface } from '@adityadeokar/velora';

// Replace the placeholder panel with the requested live component and the providers it
// needs (theme, data, router), for example <AppProviders><Dashboard /></AppProviders>.
// Keep the Surface id "page": the recipe's camera rail and focus are framed around it.
export default function Survey() {
  return (
    <Surface id="page" style={{ width: 1400, height: 980 }}>
      <div style={{ width: 1400, height: 980, boxSizing: 'border-box', padding: 64, background: '#15151a', color: '#f4f4f6', font: '500 28px/1.4 system-ui, sans-serif', borderRadius: 24 }}>
        Replace this panel with your real page component.
      </div>
    </Surface>
  );
}
