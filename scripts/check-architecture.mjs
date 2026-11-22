import ts from 'typescript';
import { builtinModules } from 'node:module';
import { readFileSync, readdirSync, lstatSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** SOURCE OF TRUTH: first-slice architecture checks.
 * WHAT: inspect declarations, module edges and runtime global references with TypeScript's AST.
 * WHY: shared scene and spatial owners must remain independent of host integrations.
 * WHERE: checkArchitecture accepts in-memory fixtures; checkProject and the CLI scan src/.
 * Scope: static source boundaries, not semantic detection of arbitrarily renamed copied math.
 * New external dependencies require an explicit layer decision here and a fixture.
 */
const owners = new Map([
  ['SyncProjectSchema','src/core/project.ts'], ['discoverRecipes','src/project/discovery.ts'],
  ['portableIntegration','src/project/portable.ts'], ['portableCatalog','src/project/portable.ts'],
  ...['SceneRecipeSchema','SnapshotSceneSchema','SceneSnapshotSchema','ListScenesSchema','LoadSceneSchema','OpenSceneSchema'].map(name=>[name,'src/core/recipes.ts']),['loadSceneRecipes','src/core/recipes.ts'],
  ['executeRecipeCommand','src/project/recipes.ts'],['SceneLibrary','src/preview/SceneLibrary.tsx'],
  ["PreviewDefinitionSchema","src/core/preview.ts"], ["presentPreview","src/core/preview.ts"],
  ["ScenePreview","src/preview/ScenePreview.tsx"], ["usePreviewSession","src/preview/session.ts"],
  ...["VELORA_BRAND","VELORA_PACKAGE"].map(name=>[name,"src/core/branding.ts"]),
  ...["getAuthoringGuide","reviewAuthoring","AuthoringGuideSchema"].map(name=>[name,"src/core/authoring.ts"]),
  ['ExportVideoSchema','src/core/export.ts'], ['CaptureManifestSchema','src/core/export.ts'], ['executeVideoExport','src/export/commands.ts'], ['executeSceneSnapshot','src/export/commands.ts'],
  ['executeProjectCommand', 'src/project/commands.ts'],
  ['InitProjectSchema', 'src/core/project.ts'],
  ['SceneSchema', 'src/core/scene.ts'], ['TransformSchema', 'src/core/scene.ts'],
  ['uniformFocusBlur','src/core/spatial.ts'], ['focusForSurface','src/core/spatial.ts'], ['sampleFocus','src/core/spatial.ts'], ['focusMask','src/core/spatial.ts'], ['cameraToCss','src/core/spatial.ts'],
  ...['motionDuration','motionTime','cinematicProgress','cinematicTimeAtProgress','sampleFrameTime'].map(name=>[name,'src/core/motion.ts']),
  ['CascadeSchema','src/core/choreography.ts'], ['createCascadeTracks','src/core/choreography.ts'],
  ['MotionSchema','src/core/motion.ts'], ['evaluateMotion','src/core/motion.ts'], ['loopSeam','src/core/motion.ts'],
  ['applyEasing','src/core/easing.ts'],
  // v2.1 Phase 01 owners: color math, animatable specs, the shared tangent rule and the React hook.
  ['parseCssColor','src/core/color.ts'], ['mixColors','src/core/color.ts'],
  ['AnimatableSpecSchema','src/core/animatable.ts'], ['monotoneTangents','src/core/motion.ts'],
  ['useAnimatable','src/react/animatable.ts'],
  // v2.1 Phase 02 owners: cascade clips, rigs and constraint resolution inside the spatial owner;
  // Phase 06 adds the projection owners (forward, ray, plane intersection, surface quads).
  ['createCascadeClip','src/core/choreography.ts'], ['buildOrbitRig','src/core/shots.ts'], ['resolveConstraints','src/core/spatial.ts'], ['projectWorld','src/core/spatial.ts'], ['screenRay','src/core/spatial.ts'], ['intersectPlane','src/core/spatial.ts'], ['surfaceQuad','src/core/spatial.ts'],
  // v2.1 Phase 03 owners: the edit vocabulary and reducer, the formatting-preserving writer and the edit command.
  // v2.1 Phase 04 owners: the editor store, intents, command registry and the Scene inspector hook.
  ['createEditorStore','src/editor/store.ts'], ['intentToOps','src/editor/intents.ts'], ['EDITOR_COMMANDS','src/editor/commands.ts'], ['useSceneInspector','src/react/inspector.ts'],
  ['EditOpSchema','src/core/edit.ts'], ['applyEdits','src/core/edit.ts'], ['formatJsonDocument','src/core/json.ts'], ['executeEditCommand','src/project/edit.ts'],
  // v2.1 Phase 07 owners: behaviors, presets, the text animator math and the motion-graphics kit.
  ['buildBehavior','src/core/behaviors.ts'], ['BEHAVIOR_CATALOG','src/core/behaviors.ts'], ['PresetSchema','src/core/presets.ts'], ['textAnimatorAt','src/core/typography.ts'],
  ['TextAnimator','src/kit/text-animator.tsx'], ['DrawPath','src/kit/draw-path.tsx'], ['Shape','src/kit/shape.tsx'],
  ['SourceOutlineSchema','src/core/source.ts'], ['outlineSource','src/project/source.ts'], ['wrapElement','src/project/source.ts'],
  ['NoiseSchema','src/core/noise.ts'], ['sampleNoise','src/core/noise.ts'],
  ...['perspectiveForFocalLength','focalLengthForPerspective','lensFor'].map(name=>[name,'src/core/lens.ts']),
  ['evaluateScene', 'src/core/spatial.ts'], ['transformToCss', 'src/core/spatial.ts'],
  ...['StageSchema','STAGE_PRESETS','resolutionBudget'].map(name=>[name,'src/core/stage.ts']),
  ['AppStage','src/react/stage.tsx'], ['useAppStage','src/react/stage.tsx'],
  ...['DEPTH_TIERS','classifyDepth','evaluateDepthLayers'].map(name=>[name,'src/core/depth.ts']),
  ['createStyleLedger','src/react/depth/ledger.ts'],
  ['ElementTargetSchema','src/core/targets.ts'], ['resolveTarget','src/core/targets.ts'], ['measureAnchors','src/react/anchors.ts'],
  ['LENS_PRESETS','src/core/lens.ts'], ['lensPreset','src/core/lens.ts'], ['applyLens','src/core/lens.ts'],
  ['buildRackFocus','src/core/shots.ts'], ['coverScaleAt','src/core/spatial.ts'],
]);
// Inert identity records are frozen object literals rather than schemas or functions.
// Frozen catalogs (an array literal, possibly under `satisfies`/`as`) count the same way.
const frozenMetadata = new Set(['VELORA_BRAND', 'VELORA_PACKAGE', 'EDITOR_COMMANDS', 'BEHAVIOR_CATALOG', 'STAGE_PRESETS', 'DEPTH_TIERS', 'LENS_PRESETS']);
const layers = {
  core: { local: ['core'], external: ['zod'] },
  runtime: { local: ['core', 'runtime'], external: ['zod'] },
  react: { local: ['core', 'runtime', 'react'], external: ['react', 'react-dom', 'react-error-boundary', 'zod'] },
  kit: { local: ['core', 'react', 'kit'], external: ['react', 'react-dom'] },
  preview: { local: ['core', 'react', 'kit', 'preview'], external: ['react', 'react-dom'] },
  commands: { local: ['core', 'commands', 'projectAdapter', 'sourceAdapter', 'projectErrors', 'services', 'bridgeServices'], external: ['zod'] },
  projectAdapter: { local: ['core', 'projectAdapter', 'projectErrors'], external: ['typescript', 'zod'] },
  projectErrors: { local: ['projectErrors'], external: [] },
  services: { local: ['core', 'services', 'projectErrors'], external: ['zod', 'typescript'] },
  // v2.1 layers (plan/v2.1 Phase 00.5). Owners are registered only in the phase that implements them.
  // editor: the studio Edit mode, loaded lazily by preview; it never reaches project/export effects or 3D.
  editor: { local: ['core', 'react', 'kit', 'preview', 'editor'], external: ['react', 'react-dom'] },
  // three: the optional /three entry (React Three Fiber); the editor reaches it only through the registry.
  three: { local: ['core', 'react', 'kit', 'three'], external: ['react', 'react-dom', 'three', '@react-three/fiber'] },
  // bridgeServices: the loopback edit bridge's effects (same policy as services).
  bridgeServices: { local: ['core', 'services', 'bridgeServices', 'projectErrors'], external: ['zod', 'typescript'] },
  // sourceAdapter: JSX outline and codemods through the TypeScript compiler API (same policy as projectAdapter).
  sourceAdapter: { local: ['core', 'projectAdapter', 'sourceAdapter', 'projectErrors'], external: ['typescript', 'zod'] },
  exportCommands: {local:['core','commands','exportCommands','exportServices','services','projectErrors'], external:['zod']},
  exportServices: {local:['core','exportServices','services','projectErrors'],external:['zod','playwright']},
  cli: { local: ['core', 'commands', 'exportCommands', 'cli'], external: [] },
};
const nodeModules = new Set(builtinModules.map(name => name.replace(/^node:/, '')));
const nodeGlobals = new Set(['process', 'Buffer', 'global', '__dirname', '__filename', 'module', 'exports', 'setImmediate', 'clearImmediate', 'Deno', 'Bun']);
// Use the installed compiler's actual DOM value declarations, not matches in application text.
const domLibrary = ts.createSourceFile('lib.dom.d.ts', readFileSync(path.join(path.dirname(ts.getDefaultLibFilePath({})), 'lib.dom.d.ts'), 'utf8'), ts.ScriptTarget.Latest, true);
const domGlobals = new Set(['self', 'window', 'document', 'globalThis']);
for (const statement of domLibrary.statements) {
  if (ts.isVariableStatement(statement)) {
    for (const declaration of statement.declarationList.declarations) {
      if (ts.isIdentifier(declaration.name)) domGlobals.add(declaration.name.text);
    }
  } else if ((ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)) && statement.name) domGlobals.add(statement.name.text);
}
const normalize = name => path.posix.normalize(name.replaceAll('\\', '/').replace(/^\.\//, ''));
const sourcePattern = /\.(?:[cm]?[jt]sx?)$/;
const layerOf = name => {
  if (/^src\/project\/errors(?:\.[cm]?[jt]s)?$/.test(name)) return 'projectErrors';
  if (/^src\/project\/(?:commands|recipes|discovery|edit|source-edit|composition-edit)(?:\.[cm]?[jt]s)?$/.test(name)) return 'commands';
  if (/^src\/project\/services\//.test(name)) return 'bridgeServices';
  if (/^src\/project\/services(?:\.[cm]?[jt]s)?$/.test(name)) return 'services';
  if (/^src\/project\/source(?:\.[cm]?[jt]s)?$/.test(name)) return 'sourceAdapter';
  if (/^src\/export\/commands\.[cm]?[jt]s$/.test(name)) return 'exportCommands';
  if (name.startsWith('src/export/')) return 'exportServices';
  if (name.startsWith('src/project/')) return 'projectAdapter';
  return /^src\/(core|runtime|react|kit|preview|editor|three|cli)(?:\/|$)/.exec(name)?.[1];
};
const browserLayers = new Set(['react', 'kit', 'preview', 'editor', 'three']);
// Layers with Node effects: built-in modules and host globals are their job.
const effectLayers = new Set(['services', 'exportServices', 'bridgeServices']);
// D8: GSAP's license forbids use in visual animation builders, so it never enters any layer.
const isGsap = specifier => /^(?:gsap|@gsap\/[^/]+)(?:\/|$)/.test(specifier);
// The only allowed edge from preview to the editor: a lazy import() from the Edit mode switch.
const EDITOR_ENTRY = 'src/preview/EditMode.tsx';
const packageOf = name => name.startsWith('@') ? name.split('/').slice(0, 2).join('/') : name.split('/')[0];

/** Returns actionable diagnostics; fixtures and the CLI use exactly the same rules. */
export function checkArchitecture(input, { compilerOptions = {} } = {}) {
  const sources = new Map(Object.entries(input).map(([name, text]) => [normalize(name), text]));
  const root = '/__velora_architecture__';
  const virtualName = name => `${root}/${name}`;
  const files = new Map([...sources].map(([name, text]) => [virtualName(name), ts.createSourceFile(virtualName(name), text, ts.ScriptTarget.Latest, true)]));
  const options = { ...compilerOptions, noLib: true, noResolve: true, allowJs: true, jsx: ts.JsxEmit.ReactJSX };
  if (options.baseUrl) options.baseUrl = virtualName(normalize(options.baseUrl));
  const host = {
    getSourceFile: name => files.get(name), getDefaultLibFileName: () => '', writeFile() {},
    getCurrentDirectory: () => root, getDirectories: () => [],
    fileExists: name => files.has(name), readFile: name => files.get(name)?.text,
    getCanonicalFileName: name => name, useCaseSensitiveFileNames: () => true, getNewLine: () => '\n',
  };
  const program = ts.createProgram([...files.keys()], options, host);
  const checker = program.getTypeChecker();
  const issues = [];
  const implementations = new Map([...owners.keys()].map(name => [name, []]));
  const add = (file, node, rule, message) => {
    const position = file.getLineAndCharacterOfPosition(node?.getStart(file) ?? 0);
    issues.push({ file: normalize(file.fileName.slice(root.length + 1)), line: position.line + 1, column: position.character + 1, rule, message });
  };
  const isLocal = node => {
    const symbol = ts.isShorthandPropertyAssignment(node.parent)
      ? checker.getShorthandAssignmentValueSymbol(node.parent) : checker.getSymbolAtLocation(node);
    return symbol?.declarations?.some(declaration => files.has(declaration.getSourceFile().fileName));
  };
  const bindingNames = name => ts.isIdentifier(name) ? [name] : name.elements.flatMap(element => ts.isOmittedExpression(element) ? [] : bindingNames(element.name));

  for (const [absoluteName, file] of files) {
    const name = absoluteName.slice(root.length + 1);
    const layer = layerOf(name);
    for (const diagnostic of file.parseDiagnostics) add(file, undefined, 'syntax', ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'));

    function hostStyleWrite(node) {
      if (!(name.startsWith('src/kit/') || name.startsWith('src/react/depth/')) || name === 'src/react/depth/ledger.ts') return;
      const member = expression => ts.isPropertyAccessExpression(expression) ? expression.name.text
        : ts.isElementAccessExpression(expression) && ts.isStringLiteralLike(expression.argumentExpression) ? expression.argumentExpression.text : undefined;
      const inside = expression => ts.isPropertyAccessExpression(expression) || ts.isElementAccessExpression(expression);
      let target;
      if (ts.isBinaryExpression(node) && node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment && node.operatorToken.kind <= ts.SyntaxKind.LastAssignment) target = node.left;
      if (ts.isCallExpression(node) && ['setProperty','removeProperty','setAttribute','removeAttribute'].includes(member(node.expression))) {
        if (['setAttribute','removeAttribute'].includes(member(node.expression))) {
          if (node.arguments[0] && ts.isStringLiteralLike(node.arguments[0]) && node.arguments[0].text.toLowerCase() === 'style')
            add(file, node, 'host-style-ledger', 'Use createStyleLedger for host inline styles.');
          return;
        }
        target = node.expression;
      }
      if (!target || !inside(target)) return;
      const style = member(target) === 'style' ? target : target.expression;
      if (!inside(style) || member(style) !== 'style') return;
      const element = ts.isElementAccessExpression(style.expression) ? style.expression.expression : style.expression;
      if (name === 'src/react/depth/Volumetric.tsx' && ts.isIdentifier(element)) {
        const declaration = checker.getSymbolAtLocation(element)?.valueDeclaration;
        if (declaration && ts.isVariableDeclaration(declaration) && declaration.initializer?.getText(file).includes('.createElement(')) return;
      }
      add(file, node, 'host-style-ledger', 'Use createStyleLedger for host inline styles.');
    }

    function dependency(expression, dynamic = false) {
      if (!layer) return;
      if (!expression || !(ts.isStringLiteral(expression) || ts.isNoSubstitutionTemplateLiteral(expression))) {
        add(file, expression, 'module-boundary', 'Module targets must be static string literals so layer boundaries can be checked.');
        return;
      }
      const specifier = expression.text;
      const resolved = ts.resolveModuleName(specifier, absoluteName, options, host).resolvedModule?.resolvedFileName;
      const relative = specifier.startsWith('.') ? path.posix.normalize(path.posix.join(path.posix.dirname(name), specifier)) : undefined;
      const target = resolved?.startsWith(`${root}/`) ? resolved.slice(root.length + 1) : relative;
      const builtin = nodeModules.has(specifier.replace(/^node:/, ''));
      const targetLayer = target ? layerOf(target) : undefined;
      if (isGsap(specifier)) {
        add(file, expression, 'gsap-ban', `${layer} cannot depend on ${specifier}: GSAP never enters Velora runtime or editor code (decision D8); use core/easing and core/gsap name mapping.`);
        return;
      }
      if (layer === 'preview' && targetLayer === 'editor') {
        if (!(dynamic && name === EDITOR_ENTRY)) add(file, expression, 'editor-lazy-boundary', `preview reaches the editor only through a dynamic import() in ${EDITOR_ENTRY}, so production hosts never bundle it.`);
        return;
      }
      if (layer === 'editor' && (targetLayer === 'three' || ['three', '@react-three/fiber'].includes(packageOf(specifier)))) {
        add(file, expression, 'editor-three-boundary', `editor cannot depend on ${specifier}; it reaches 3D only through the Scene registry contract.`);
        return;
      }
      if (layer === 'editor' && targetLayer && /^(?:commands|projectAdapter|sourceAdapter|projectErrors|services|bridgeServices|exportCommands|exportServices)$/.test(targetLayer)) {
        add(file, expression, 'editor-project-boundary', `editor cannot depend on ${specifier}; it persists through the edit bridge client, never project or export modules.`);
        return;
      }
      const allowed = target ? layers[layer].local.includes(targetLayer)
        : (effectLayers.has(layer) && builtin) || (!specifier.startsWith('node:') && !builtin && layers[layer].external.includes(packageOf(specifier)));
      if (!allowed) add(file, expression, 'module-boundary', `${layer} cannot depend on ${specifier}; consume its allowed canonical owners instead.`);
    }

    function declaration(node) {
      const names = ts.isVariableDeclaration(node) || ts.isParameter(node) || ts.isBindingElement(node) ? bindingNames(node.name)
        : (ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node) || ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node) || ts.isEnumDeclaration(node) || ts.isModuleDeclaration(node)) && node.name && ts.isIdentifier(node.name) ? [node.name] : [];
      for (const identifier of names) {
        const symbol = identifier.text;
        const owner = owners.get(symbol);
        if (!owner) continue;
        if (name !== owner) {
          add(file, identifier, 'canonical-owner', `${symbol} must be declared only in ${owner}; import or re-export it.`);
          continue;
        }
        const statement = ts.isVariableDeclaration(node) ? node.parent.parent : node;
        const exported = statement.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.ExportKeyword);
        const ambient = statement.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.DeclareKeyword);
        let implemented = false;
        if (frozenMetadata.has(symbol) && ts.isVariableDeclaration(node) && node.initializer) {
          const value=node.initializer;
          let frozen=ts.isCallExpression(value) && value.arguments.length===1 ? value.arguments[0] : undefined;
          while (frozen && (ts.isSatisfiesExpression(frozen) || ts.isAsExpression(frozen) || ts.isParenthesizedExpression(frozen))) frozen=frozen.expression;
          implemented=ts.isCallExpression(value) && value.expression.getText(file)==='Object.freeze' && !!frozen && (ts.isObjectLiteralExpression(frozen) || ts.isArrayLiteralExpression(frozen));
        } else if (symbol.endsWith('Schema') && ts.isVariableDeclaration(node) && node.initializer) {
          // A real schema constructor, including chained refinements, must be rooted in the Zod import.
          let expression = node.initializer;
          while (ts.isCallExpression(expression) && ts.isPropertyAccessExpression(expression.expression)) {
            const receiver = expression.expression.expression;
            if (ts.isIdentifier(receiver) && ['object', 'strictObject', 'record', 'discriminatedUnion', 'union'].includes(expression.expression.name.text)) {
              const declarations = checker.getSymbolAtLocation(receiver)?.declarations ?? [];
              // Objects need a literal shape; records need key and value schemas.
              const constructor = expression.expression.name.text;
              const shaped = constructor === 'union'
                ? expression.arguments.some(argument => ts.isArrayLiteralExpression(argument) && argument.elements.length >= 2)
                : ['record', 'discriminatedUnion'].includes(constructor) ? expression.arguments.length >= 2 : expression.arguments.some(ts.isObjectLiteralExpression);
              implemented = shaped && declarations.some(declaration => {
                let parent = declaration;
                while (parent && !ts.isImportDeclaration(parent)) parent = parent.parent;
                return parent?.moduleSpecifier && ts.isStringLiteral(parent.moduleSpecifier) && parent.moduleSpecifier.text === 'zod';
              });
              break;
            }
            expression = receiver;
          }
        } else if (!symbol.endsWith('Schema')) {
          const body = ts.isFunctionDeclaration(node) ? node.body : ts.isVariableDeclaration(node) && node.initializer && (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer)) ? node.initializer.body : undefined;
          implemented = !!body && (!ts.isBlock(body) || body.statements.length > 0);
        }
        if (exported && !ambient && ts.isFunctionDeclaration(node) && !node.body && statement.parent === file
          && file.statements.some(other => ts.isFunctionDeclaration(other) && other.name?.text === symbol && other.body)) continue;
        if (exported && !ambient && implemented && statement.parent === file) implementations.get(symbol).push(node);
        else add(file, identifier, 'canonical-implementation', `${symbol} needs an exported runtime ${frozenMetadata.has(symbol) ? 'frozen metadata object' : symbol.endsWith('Schema') ? 'Zod object schema' : 'function body'} in its owner.`);
      }
    }

    function visit(node) {
      hostStyleWrite(node);
      declaration(node);
      if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
        if (node.moduleSpecifier) dependency(node.moduleSpecifier);
      } else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) dependency(node.moduleReference.expression);
      else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) dependency(node.argument.literal);
      else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) dependency(node.arguments[0], true);
      else if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'require' && !isLocal(node.expression)) dependency(node.arguments[0]);

      if (layer && !browserLayers.has(layer) && (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node) || ts.isJsxFragment(node))) {
        add(file, node, 'module-boundary', `${layer} cannot introduce an implicit JSX renderer dependency.`);
      }

      // Types and property names are not runtime global reads. Shorthand properties are reads.
      if (layer && ts.isIdentifier(node) && !isLocal(node)) {
        const parent = node.parent;
        const propertyName = (ts.isPropertyAccessExpression(parent) && parent.name === node)
          || ((ts.isPropertyAssignment(parent) || ts.isMethodDeclaration(parent) || ts.isPropertyDeclaration(parent)) && parent.name === node)
          || ts.isImportSpecifier(parent) || ts.isExportSpecifier(parent);
        const forbidden = !effectLayers.has(layer) && (
          (nodeGlobals.has(node.text) && !(layer === 'cli' && node.text === 'process'))
          || (!browserLayers.has(layer) && domGlobals.has(node.text) && !(layer === 'commands' && node.text === 'URL'))
        );
        if (!propertyName && forbidden) add(file, node, 'runtime-global', `${layer} cannot read host runtime global ${node.text}.`);
        if (!propertyName && node.text === 'require' && !(ts.isCallExpression(parent) && parent.expression === node)) {
          add(file, node, 'module-boundary', 'Use a direct require with a static module target; aliases cannot be checked.');
        }
        if (browserLayers.has(layer) && !propertyName && node.text === 'globalThis' && !((ts.isPropertyAccessExpression(parent) || ts.isElementAccessExpression(parent)) && parent.expression === node)) {
          add(file, node, 'runtime-global', 'Use a static globalThis property; global aliases and destructuring can conceal Node access.');
        }
      }
      // globalThis.process and globalThis['Buffer'] are Node access even in the React adapter.
      if (browserLayers.has(layer) && (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) && ts.isIdentifier(node.expression) && node.expression.text === 'globalThis' && !isLocal(node.expression)) {
        const key = ts.isPropertyAccessExpression(node) ? node.name.text : node.argumentExpression && ts.isStringLiteral(node.argumentExpression) ? node.argumentExpression.text : undefined;
        if (!key || nodeGlobals.has(key)) add(file, node, 'runtime-global', 'React cannot read Node globals or computed globalThis members.');
      }
      ts.forEachChild(node, child => {
        // Still check import types, but do not mistake DOM type names for DOM runtime use.
        if (ts.isTypeNode(child) && !ts.isImportTypeNode(child)) {
          const importsOnly = type => { if (ts.isImportTypeNode(type) && ts.isLiteralTypeNode(type.argument)) dependency(type.argument.literal); ts.forEachChild(type, importsOnly); };
          importsOnly(child);
        } else visit(child);
      });
    }
    visit(file);

    if ([...owners.values()].includes(name)) {
      const comments = [];
      // Leading AST trivia only: strings containing documentation cannot satisfy this rule.
      for (const statement of file.statements) for (const range of ts.getLeadingCommentRanges(file.text, statement.getFullStart()) ?? []) comments.push(file.text.slice(range.pos, range.end));
      const symbols = [...owners].filter(([, owner]) => owner === name).map(([symbol]) => symbol);
      const documented = comments.some(comment => /SOURCE OF TRUTH\s*:/i.test(comment) && symbols.every(symbol => comment.includes(symbol)) && ['WHAT', 'WHY', 'WHERE'].every(label => {
        const value = new RegExp(`\\b${label}:([^\\n]+)`).exec(comment)?.[1]?.replace(/\*\//g, '').trim();
        return value && value.split(/\s+/).length >= 3 && !/^(todo|tbd|n\/a)\b/i.test(value);
      }));
      if (!documented) add(file, undefined, 'owner-documentation', `Document SOURCE OF TRUTH (${symbols.join(', ')}) and substantive WHAT/WHY/WHERE clauses in an owner comment.`);
    }
  }
  for (const [symbol, owner] of owners) {
    if (implementations.get(symbol).length !== 1) issues.push({ file: owner, line: 1, column: 1, rule: 'canonical-presence', message: `Expected exactly one exported runtime implementation of ${symbol} in ${owner}.` });
  }
  return issues;
}

/** SOURCE OF TRUTH: documentation allowlist.
 * WHAT: docs contains exactly two regular files, architecture.md and product.md.
 * WHY: prevent additional documents from creating competing or stale authorities.
 * WHERE: checkProject, its CLI, build and architecture tests enforce this boundary.
 */
export const DOCUMENTATION_FILES = Object.freeze(['architecture.md', 'product.md']);
export function checkDocumentation(directory) {
  const issues = [];
  const reject = (file, message) => issues.push({file, line:1, column:1, rule:'documentation-boundary', message});
  const folder = path.join(directory, 'docs');
  let stat;
  try { stat = lstatSync(folder); } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    reject('docs', 'Missing docs directory: require architecture.md and product.md.');
    return issues;
  }
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    reject('docs', 'docs must be a real directory, not a file or symbolic link.');
    return issues;
  }
  const entries = readdirSync(folder, {withFileTypes:true});
  for (const entry of entries) {
    if (!DOCUMENTATION_FILES.includes(entry.name) || !entry.isFile())
      reject('docs/'+entry.name, 'Only regular docs/architecture.md and docs/product.md are allowed. Move architecture requirements into architecture.md and product requirements into product.md; no extra files, directories or links.');
  }
  for (const name of DOCUMENTATION_FILES) {
    if (!entries.some(entry => entry.name === name && entry.isFile()))
      reject('docs/'+name, 'Required canonical documentation file is missing or is not a regular file.');
  }
  return issues;
}

export function checkProject(directory = process.cwd()) {
  const sources = {};
  function read(directoryName) {
    for (const entry of readdirSync(path.join(directory, directoryName), { withFileTypes: true })) {
      const name = `${directoryName}/${entry.name}`;
      if (entry.isDirectory()) read(name);
      else if (sourcePattern.test(name)) sources[name] = readFileSync(path.join(directory, name), 'utf8');
    }
  }
  read('src'); // Missing source is an error, never a successful empty scan.
  const configPath = ts.findConfigFile(directory, ts.sys.fileExists);
  let compilerOptions = {};
  if (configPath) {
    const config = ts.readConfigFile(configPath, ts.sys.readFile);
    if (config.error) throw new Error(ts.flattenDiagnosticMessageText(config.error.messageText, '\n'));
    const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, path.dirname(configPath));
    if (parsed.errors.length) throw new Error(parsed.errors.map(error => ts.flattenDiagnosticMessageText(error.messageText, '\n')).join('\n'));
    compilerOptions = parsed.options;
    if (compilerOptions.baseUrl) compilerOptions.baseUrl = path.relative(directory, compilerOptions.baseUrl);
  }
  return [...checkArchitecture(sources, { compilerOptions }), ...checkDocumentation(directory)];
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const issues = checkProject(process.argv[2] ? path.resolve(process.argv[2]) : process.cwd());
    for (const issue of issues) console.error(`${issue.file}:${issue.line}:${issue.column} [${issue.rule}] ${issue.message}`);
    if (issues.length) process.exitCode = 1;
    else console.log('Architecture checks passed.');
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
