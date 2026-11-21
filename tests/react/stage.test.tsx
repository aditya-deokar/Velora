// @vitest-environment jsdom
import { render } from "@testing-library/react";
import { expect, it } from "vitest";
import { stageFromSpec } from "../../src/core/stage";
import { AppStage, Scene, useAppStage } from "../../src/react";
import { RouteFrame } from "../../src/kit/RouteFrame";

function StageValue() {
  return <output data-testid="stage-value">{JSON.stringify(useAppStage())}</output>;
}

it("supplies stage layout, a named query container and inherited iframe sizing", () => {
  const stage = stageFromSpec("laptop-14")!;
  const view = render(<Scene stage={stage}><AppStage>
    <StageValue/><RouteFrame route="/pricing" title="Inherited"/><RouteFrame route="/pricing" width={640} height={480} title="Explicit"/>
  </AppStage></Scene>);
  expect(JSON.parse(view.getByTestId("stage-value").textContent!)).toEqual({
    width: 1512, height: 982, dpr: 2, aspect: 1512 / 982, physicalWidthMm: 302,
  });
  const app = view.container.querySelector<HTMLElement>("[data-velora-app-stage]")!;
  expect(app.style.width).toBe("1512px");
  expect(app.style.height).toBe("982px");
  expect(app.style.containerName).toBe("velora-app-stage");
  expect(app.style.containerType).toBe("size");
  expect((view.getByTitle("Inherited") as HTMLIFrameElement).style.width).toBe("100%");
  expect((view.getByTitle("Explicit") as HTMLIFrameElement).style.width).toBe("640px");
  expect((view.getByTitle("Explicit") as HTMLIFrameElement).style.height).toBe("480px");
  view.unmount();
});
