/** SOURCE OF TRUTH: VELORA_BRAND, VELORA_PACKAGE.
 * WHAT: product attribution, the creator's verified public channel and the public npm identity with its preview subpath.
 * WHY: studio, CLI, generated adapters and installed guidance must share one name and import what npm actually installed.
 * WHERE: browser adapters and CLI presentation consume the brand; project generators, installation checks,
 * the authoring guide and the handoff consume the package. Tests pin the package to package.json.
 * Legacy package names are recognized on disk for upgrades only; Velora never generates them.
 */
export const VELORA_BRAND=Object.freeze({name:'Velora',creator:'Aditya Deokar',title:'Velora by Aditya Deokar',url:'https://github.com/aditya-deokar'});
export const VELORA_PACKAGE=Object.freeze({name:'@adityadeokar/velora',preview:'@adityadeokar/velora/preview',legacyNames:Object.freeze(['velora'])});
