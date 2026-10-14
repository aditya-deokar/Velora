import { VELORA_BRAND } from '../core';

/** SOURCE OF TRUTH: BrandAttribution.
 * WHAT: accessible creator attribution for studio chrome.
 * WHY: every visible creator name links to the canonical VELORA_BRAND destination.
 * WHERE: SceneLibrary, GettingStarted and ScenePreview; never inside scene capture.
 */
export function BrandAttribution({showName = true}: {showName?: boolean}) {
  return <span className="velora-attribution">{showName && <>{VELORA_BRAND.name} </>}by <a href={VELORA_BRAND.url} target="_blank" rel="noopener noreferrer" aria-label={VELORA_BRAND.creator + ' (opens in a new tab)'}>{VELORA_BRAND.creator}</a></span>;
}
