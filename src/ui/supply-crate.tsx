import type { Command } from "../core/game";
import { ctx, L, U } from "./ctx";
export function SupplyCratePanel({ id, act }: { id: string; act: (cmd: Command) => void }) {
  const g = ctx.game!, w = g.world; if (w.level !== "level-1") return null;
  const crate = w.crates.get(id); if (!crate) return null;
  const t = w.rules.crate;
  const knows = crate.examined || g.meta.clues.includes("warehouse_latch");
  return <>
    {!crate.opened && <>
      <p class="story">{L(t.description)}</p>
      {knows && <p class="story">{L(t.latch)}</p>}
      {!knows && <button class="opt" onClick={() => act({ type: "crateExamine", id })}>{U("crateExamine")}<small>{U("minutes", { m: t.examineMinutes })}</small></button>}
      <button class="opt" disabled={!knows && !g.has("crowbar")} onClick={() => act({ type: "crateOpen", id })}>{U(g.has("crowbar") ? "crateCrowbar" : "crateOpen")}<small>{U("minutes", { m: g.has("crowbar") ? t.crowbarMinutes : t.openMinutes })}</small></button>
    </>}
    {crate.opened && (crate.items.length ? crate.items.map(it => <button class="opt" key={it.key} onClick={() => act({ type: "crateTake", id, key: it.key })}>{L(g.itemName(it))}<small>{U("pickUp")}</small></button>) : <p class="story">{L(t.empty)}</p>)}
  </>;
}
