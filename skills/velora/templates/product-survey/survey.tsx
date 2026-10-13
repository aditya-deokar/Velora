import { Surface } from 'velora';

export default function Survey({ page }: { page: React.ReactNode }) {
  return (
    <Surface id="page" style={{ width: 1400, height: 980 }}>
      {page}
    </Surface>
  );
}
