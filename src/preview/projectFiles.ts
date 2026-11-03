declare global {
  // Set by any-site mode's studio entry: Vite's file-server base for the project directory.
  var __VELORA_PROJECT_FILES__: string | undefined;
}
/** Project files (captions, words, brand) are served from the app origin in React hosts; any-site mode's studio
 * sets __VELORA_PROJECT_FILES__ to Vite's file-server base because the origin root belongs to the proxied site. */
export function projectFileUrl(file: string): URL {
  return new URL((globalThis.__VELORA_PROJECT_FILES__ ?? "/") + file.replace(/^\.?\//, ""), location.origin);
}
