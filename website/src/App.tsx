import { useEffect, useMemo, useState, type ReactNode } from "react";
import site from "./generated/site.json";

type Page = "start" | "studio" | "templates" | "cookbook" | "craft" | "deliver" | "cli" | "schemas";
const PAGES: { id: Page; label: string }[] = [
  { id: "start", label: "Start" }, { id: "studio", label: "Studio" }, { id: "templates", label: "Templates" }, { id: "cookbook", label: "Cookbook" },
  { id: "craft", label: "Craft" }, { id: "deliver", label: "Deliver" }, { id: "cli", label: "CLI" }, { id: "schemas", label: "Schemas" },
];
const media = (file: string) => import.meta.env.BASE_URL + file;

function usePage(): Page {
  const read = () => (PAGES.find((page) => location.hash === `#/${page.id}`)?.id ?? "start");
  const [page, setPage] = useState<Page>(read);
  useEffect(() => {
    const update = () => { setPage(read()); window.scrollTo(0, 0); };
    window.addEventListener("hashchange", update);
    return () => window.removeEventListener("hashchange", update);
  }, []);
  return page;
}
function Code({ children }: { children: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="code">
      <pre><code>{children}</code></pre>
      <button onClick={() => navigator.clipboard?.writeText(children).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); })}>{copied ? "Copied" : "Copy"}</button>
    </div>
  );
}
function Section({ title, lede, children }: { title: string; lede?: string; children: ReactNode }) {
  return <section className="section"><h2>{title}</h2>{lede && <p className="lede">{lede}</p>}{children}</section>;
}

function Hero() {
  const files = site.hero?.files ?? [];
  const webm = files.find((file) => file.path.endsWith(".webm"));
  const mp4 = files.find((file) => file.path.endsWith(".mp4"));
  const poster = files.find((file) => file.role === "poster");
  const local = (file?: { path: string }) => file ? media("media/hero/" + file.path.split("/").pop()) : undefined;
  const [reduced, setReduced] = useState(false);
  useEffect(() => { const query = matchMedia("(prefers-reduced-motion: reduce)"); setReduced(query.matches); }, []);
  return (
    <header className="hero">
      <div className="hero-copy">
        <p className="eyebrow">Velora {site.version}</p>
        <h1>Cinematic launch video from your real product UI.</h1>
        <p className="lede">Templates borrowed from film craft, an editor's toolkit, and every platform file from one command. Your coding agent drives it; your components stay yours.</p>
        <div className="actions"><a className="button primary" href="#/start">Five-minute start</a><a className="button" href="#/templates">Browse templates</a></div>
      </div>
      <div className="hero-media">
        {webm && !reduced ? (
          <video autoPlay muted loop playsInline preload="metadata" poster={local(poster)} width={1280} height={720}>
            <source src={local(webm)} type="video/webm" />
            {mp4 && <source src={local(mp4)} type="video/mp4" />}
          </video>
        ) : poster ? <img src={local(poster)} width={1280} height={720} alt="A Velora shot of this page" />
          : site.shots[0] ? <img src={media(site.shots[0].src)} width={1280} height={720} alt={site.shots[0].caption} style={{ objectFit: "cover" }} />
          : <div className="placeholder">Velora</div>}
        {site.hero && <p className="evidence">Rendered by Velora from the <code>website-hero-loop-8s</code> blueprint of this page ({site.hero.createdAt.slice(0, 10)}).</p>}
      </div>
    </header>
  );
}

function Start() {
  return (
    <>
      <Hero />
      <Section title="Five minutes, React app" lede="Run in your app's root with its dev server on port 5173.">
        <Code>{`npm install ${site.packageName}
npx velora init --json
npx velora skills install --agent claude --json
npx velora new scene --template hero-push --id home-hero --route / --json
npx velora shot --scene home-hero --time 3000 --out home-hero.png --url http://127.0.0.1:5173 --json`}</Code>
      </Section>
      <Section title="Any website" lede="Astro, SvelteKit, Rails, Django or static HTML: a managed studio films your real routes through a same-origin proxy. Nothing is installed into your project.">
        <Code>{`npx velora studio init --site http://127.0.0.1:4321
npx velora new scene --template scroll-through --id tour --route / --json
npx velora studio --site http://127.0.0.1:4321`}</Code>
      </Section>
      <Section title="No product UI yet" lede="A starter launch studio with a branded page, a brand file and a blueprint.">
        <Code>{`npx ${site.packageName} create my-launch --name "Your product"`}</Code>
      </Section>
      <Section title="Hand it to your agent" lede="Prompts name the blueprint, the skills to load and the proof loop. Replace the <placeholders>.">
        <div className="cards">{site.prompts.filter((prompt) => prompt.featured).map((prompt) => (
          <article key={prompt.id} className="card"><h3>{prompt.title}</h3><p>{prompt.intent}</p><Code>{`npx velora prompts show --id ${prompt.id}`}</Code></article>
        ))}</div>
      </Section>
    </>
  );
}

function Templates() {
  const [filter, setFilter] = useState("all");
  const categories = useMemo(() => ["all", ...new Set(site.templates.map((template) => template.category))], []);
  const list = site.templates.filter((template) => filter === "all" || template.category === filter);
  return (
    <>
      <Section title="Storyboards from real runs" lede="Contact sheets rendered by Velora in the recorded agent demos.">
        <div className="shots">{site.shots.map((shot) => (
          <figure key={shot.src}><img src={media(shot.src)} alt={shot.caption} loading="lazy" /><figcaption><strong>{shot.title}.</strong> {shot.caption}</figcaption></figure>
        ))}</div>
      </Section>
      <Section title="Templates" lede="Certified starting points scaffolded as plain files you own. Every one passes framing, determinism and budget checks.">
        <div className="filters">{categories.map((category) => <button key={category} className={category === filter ? "active" : ""} onClick={() => setFilter(category)}>{category}</button>)}</div>
        <div className="cards">{list.map((template) => (
          <article key={template.id} className="card">
            <p className="tag">{template.category}</p><h3>{template.title}</h3><p>{template.summary}</p>
            <p className="meta">{template.aspects.join(" · ")} · params: {template.params.join(", ")}</p>
            <Code>{`npx velora new scene --template ${template.id} --id my-shot --route /`}</Code>
          </article>
        ))}</div>
      </Section>
      <Section title="Blueprints" lede="Whole films: shots, transitions with sound, overlays, markers, captions and a story brief.">
        <div className="cards">{site.blueprints.map((blueprint) => (
          <article key={blueprint.id} className="card">
            <h3>{blueprint.title}</h3><p>{blueprint.summary}</p><p className="meta">{blueprint.scenes.join(" → ")}</p>
            <Code>{`npx velora new video --blueprint ${blueprint.id} --id launch --route /`}</Code>
          </article>
        ))}</div>
      </Section>
    </>
  );
}

function Studio() {
  const video = site.hero?.files.find(file => file.path.endsWith(".mp4"));
  const poster = site.hero?.files.find(file => file.role === "poster");
  const local = (file?: { path: string }) => file ? media("media/hero/" + file.path.split("/").pop()) : undefined;
  return <>
    <Section title="Edit the scene and the cut" lede="Set keyframes on your live app, review the timing, and hand a focused edit to your coding agent.">
      <Code>{`npx velora edit --scene home-hero
npx velora edit --composition launch.composition.json`}</Code>
      <div className="cards">
        <article className="card"><h3>Shape a shot</h3><p>Set keyframes in the Inspector, refine easing in the graph, and group tracks into a timed clip.</p></article>
        <article className="card"><h3>Cut the film</h3><p>Trim and reorder scenes, blend cuts, and align picture to audio and beat markers.</p></article>
        <article className="card"><h3>Hand off the next edit</h3><p>Copy your selected tracks or shot, playhead, and intent to your coding agent. Changes land in the same recipe or composition file.</p></article>
      </div>
    </Section>
    {video && <Section title="A render from the live website">
      <figure className="hero-media">
        <video controls playsInline preload="metadata" poster={local(poster)} src={local(video)} width={1280} height={720} aria-label="Velora camera move over the documentation website"/>
        <figcaption className="evidence">Velora rendered this silent camera move from the live documentation site.</figcaption>
      </figure>
    </Section>}
  </>;
}

function Cookbook() {
  const titles: Record<string, string> = { "demo-c": "Launch film (30 s)", "demo-d": "Website hero loop", "demo-e": "Vertical teaser with captions" };
  return (
    <>{site.demos.map((demo) => (
      <Section key={demo.demo} title={titles[demo.demo] ?? demo.demo} lede={`Recorded with ${demo.agent}. Every command below ran for real; replayable steps are re-run by test:agent-demos.`}>
        <Code>{demo.steps.map((step) => step.cmd).join("\n")}</Code>
        <details><summary>Starting prompt</summary><pre className="prose">{demo.prompt}</pre></details>
        <details><summary>What the run found and fixed</summary><pre className="prose">{demo.fixes}</pre></details>
      </Section>
    ))}</>
  );
}

function Craft() {
  const craft = site.skills.filter((skill) => skill.craftNotes);
  return (
    <>
      <Section title="Craft guides" lede="The ideas behind the templates, from film and editing practice. The same notes ship in the skills your agent loads.">
        {craft.map((skill) => (
          <article key={skill.name} className="craft"><h3>{skill.name.replace("velora-", "")}</h3><p className="meta">{skill.description}</p><pre className="prose">{skill.craftNotes}</pre></article>
        ))}
      </Section>
      <Section title="Transitions">
        <table><thead><tr><th>Type</th><th>Mode</th><th>Use</th></tr></thead><tbody>
          {site.transitions.map((transition) => <tr key={transition.type}><td><code>{transition.type}</code></td><td>{transition.mode}</td><td>{transition.description}</td></tr>)}
        </tbody></table>
      </Section>
      <Section title="Skills" lede="Installed with velora skills install; the root skill routes each intent to at most four.">
        <table><tbody>{site.skills.map((skill) => <tr key={skill.name}><td><code>{skill.name}</code></td><td>{skill.whenToUse}</td></tr>)}</tbody></table>
      </Section>
    </>
  );
}

function Deliver() {
  const presets = new Map(site.presets.map((preset) => [preset.id, preset]));
  return (
    <>
      <Section title="Every platform, one command" lede="Each target renders at its preset, climbs a deterministic quality ladder until it fits the size budget, and lands in deliverables.json with its SHA.">
        <Code>{`npx velora deliver --composition launch.composition.json --targets youtube,reels,tiktok,website-hero,readme-gif,og-image --json`}</Code>
        <table><thead><tr><th>Target</th><th>Preset</th><th>Size</th><th>Codec</th><th>Budget</th><th>Checked</th></tr></thead><tbody>
          {site.deliverTargets.map((target) => { const preset = presets.get(target.preset)!; return (
            <tr key={target.name}><td><code>{target.name}</code></td><td>{preset.title}</td><td>{preset.width}×{preset.height}</td><td>{preset.codec}</td>
              <td>{preset.maxBytes ? `${Math.round(preset.maxBytes / 1048576)} MB` : "—"}</td><td>{preset.lastVerified}</td></tr>); })}
        </tbody></table>
      </Section>
      <Section title="Website hero" lede="WebM first, MP4 fallback, a poster, fixed dimensions and a reduced-motion fallback: embed.html and HeroVideo.tsx are written for you." >
        <Code>{`<video autoplay muted loop playsinline preload="metadata" poster="hero.poster.jpg" width="1920" height="1080">
  <source src="hero.webm" type="video/webm">
  <source src="hero.mp4" type="video/mp4">
</video>`}</Code>
      </Section>
    </>
  );
}

function Cli() {
  return (
    <Section title="CLI reference" lede="Generated from the command index and each command's --help. Every command supports --json; exit 0 ok, 1 operational failure, 2 usage error.">
      {site.commands.map((command) => (
        <article key={command.name} className="command" id={`cli-${command.name}`}>
          <h3><code>velora {command.name}</code></h3><p>{command.description} <span className="meta">Skill: {command.skill}</span></p>
          <pre className="prose">{command.help}</pre>
        </article>
      ))}
    </Section>
  );
}

type JsonSchema = { type?: string | string[]; description?: string; properties?: Record<string, JsonSchema>; required?: string[]; items?: JsonSchema; enum?: unknown[]; anyOf?: JsonSchema[]; const?: unknown; default?: unknown };
function SchemaTree({ schema, depth = 0 }: { schema: JsonSchema; depth?: number }) {
  if (!schema.properties || depth > 3) return null;
  return (
    <ul className="schema">{Object.entries(schema.properties).map(([name, child]) => {
      const nested = child.properties ? child : child.items?.properties ? child.items : undefined;
      const type = child.enum ? child.enum.map((value) => JSON.stringify(value)).join(" | ") : child.const !== undefined ? JSON.stringify(child.const) : [child.type ?? child.anyOf?.map((option) => option.type).filter(Boolean).join(" | ")].flat().join(" | ") + (child.items ? "[]" : "");
      return <li key={name}><code>{name}</code>{schema.required?.includes(name) ? <span className="required">required</span> : null} <span className="meta">{type}{child.default !== undefined ? ` = ${JSON.stringify(child.default)}` : ""}</span>{nested && <SchemaTree schema={nested} depth={depth + 1} />}</li>;
    })}</ul>
  );
}
function Schemas() {
  return (
    <Section title="File reference" lede="Generated from the JSON Schemas shipped in the package. Add $schema to your files for editor autocomplete.">
      {Object.entries(site.schemas as Record<string, JsonSchema>).map(([name, schema]) => (
        <article key={name} className="command"><h3><code>{name}.schema.json</code></h3><SchemaTree schema={schema} /></article>
      ))}
    </Section>
  );
}

export function App() {
  const page = usePage();
  return (
    <div className="site">
      <nav className="nav"><a className="brand" href="#/start">Velora</a>{PAGES.map((item) => <a key={item.id} href={`#/${item.id}`} className={item.id === page ? "active" : ""}>{item.label}</a>)}
        <a className="external" href="https://github.com/aditya-deokar/Velora">GitHub</a></nav>
      <main>
        {page === "start" && <Start />}{page === "studio" && <Studio />}{page === "templates" && <Templates />}{page === "cookbook" && <Cookbook />}
        {page === "craft" && <Craft />}{page === "deliver" && <Deliver />}{page === "cli" && <Cli />}{page === "schemas" && <Schemas />}
      </main>
      <footer>MIT · <a href="https://github.com/aditya-deokar">Aditya Deokar</a> · this site is built with React and its hero is rendered by Velora.</footer>
    </div>
  );
}
