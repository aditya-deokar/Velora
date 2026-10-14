import { useState } from 'react';
import { BrandAttribution } from './BrandAttribution';

/** SOURCE OF TRUTH: GettingStarted, FIRST_SCENE_PROMPT.
 * WHAT: installed setup instructions and a copyable external-agent handoff.
 * WHY: empty library and standalone preview share the same honest authoring path.
 * WHERE: SceneLibrary and ScenePreview; CLI guide / generated VELORA.md own authoring rules.
 */
const FIRST_SCENE_PROMPT = 'Read VELORA.md and run npx velora guide. Inspect this app’s existing components, styles and providers. Ask me which UI to feature, then create a Velora scene using the real components, intentional perspective, focal depth and motion. Save the recipe and matching component in src/velora/scenes/ so they appear in the scene library. Keep the app’s original design and data context.';

export function GettingStarted({label = 'Get started'}: {label?: string}) {
  const [copyState, setCopyState] = useState<'idle' | 'copying' | 'copied' | 'failed'>('idle');
  return <details className="velora-onboarding">
    <summary className="velora-control">{label}</summary>
    <div className="velora-onboarding-content">
      <ol>
        <li>In your app’s terminal, run <code>npx velora init</code> once to set up Velora.</li>
        <li>Keep your app’s dev server running. Give your coding agent the generated <code>VELORA.md</code> and <code>npx velora guide</code>.</li>
        <li>Ask your agent to create a scene from your existing UI. Save each recipe in <code>src/velora/scenes/</code> with its matching component. Velora discovers the files automatically.</li>
      </ol>
      <p className="velora-prompt-label">Start in your coding agent</p>
      <p className="velora-prompt">{FIRST_SCENE_PROMPT}</p>
      <button className="velora-control" disabled={copyState === 'copying'} onClick={async () => {
        setCopyState('copying');
        try { await navigator.clipboard.writeText(FIRST_SCENE_PROMPT); setCopyState('copied'); }
        catch { setCopyState('failed'); }
      }}>{copyState === 'copied' ? 'Prompt copied' : copyState === 'copying' ? 'Copying…' : 'Copy starter prompt'}</button>
      <p className="velora-copy-status" role="status">{copyState === 'failed' ? 'Clipboard unavailable. Select and copy the prompt above.' : copyState === 'copied' ? 'Paste it into your coding agent to begin.' : 'Your agent edits the source. Return here to preview and refine.'}</p>
      <BrandAttribution/>
    </div>
  </details>;
}
