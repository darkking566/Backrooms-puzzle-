import { render } from "preact";
import "./ui/style.css";
import { App } from "./ui/app";
import { ctx } from "./ui/ctx";
import { loadMeta, loadRun, openStore } from "./state/save";
import { Game } from "./core/game";

(async () => {
  await openStore();
  ctx.meta = await loadMeta();
  const run = await loadRun();
  if (run) ctx.game = new Game(ctx.content, ctx.meta, run);
  document.documentElement.lang = ctx.meta.settings.lang === "zh" ? "zh-Hant" : "en";
  render(<App />, document.getElementById("app")!);
})();
