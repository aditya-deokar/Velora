/** SOURCE OF TRUTH: parseJsonDocument.
 * WHAT: JSON.parse for hand-edited project files, tolerating a leading UTF-8 byte-order mark.
 * WHY: Windows editors (Notepad, PowerShell 5.1 Set-Content -Encoding utf8) write a BOM that
 * JSON.parse rejects, which made valid recipes and compositions look like syntax errors.
 * WHERE: project discovery and export commands parse recipes, manifests and compositions through it.
 */
export function parseJsonDocument(text: string): unknown {
  return JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);
}
