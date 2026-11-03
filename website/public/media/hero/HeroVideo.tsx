// Velora website hero: Website hero loop (8 s).
// Copy the files next to your public assets and adjust the paths. Reduced motion shows the poster.
import { useEffect, useState } from "react";

export function HeroVideo({ className }: { className?: string }) {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  const style = { display: "block", width: "100%", height: "auto", aspectRatio: "1920 / 1080" } as const;
  if (reduced) return <img className={className} src="hero.poster.jpg" width={1920} height={1080} alt="" style={style} />;
  return (
    <video className={className} autoPlay muted loop playsInline preload="metadata" poster="hero.poster.jpg" width={1920} height={1080} style={style}>
      <source src="hero.webm" type="video/webm" />
      <source src="hero.mp4" type="video/mp4" />
    </video>
  );
}
