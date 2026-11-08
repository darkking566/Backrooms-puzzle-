import { useState } from "preact/hooks";
import type { Command } from "../core/game";
import { ctx, L, U } from "./ctx";

export function RoomPersonPanel({ act, close }: { act: (cmd: Command) => void; close: () => void }) {
  const [waterKey, setWaterKey] = useState("");
  const g = ctx.game!, r = g.run.roomPerson, q = g.personQuest, water = g.personWater();
  const selected = water.find(x => x.key === waterKey) ?? water[0];
  if (!g.canTalkToPerson()) return <p class="story">{L(q.text.gone)}</p>;
  return <>
    <p class="story">{L(r.variant === "revisit" ? q.text.revisit : r.helped ? q.text.recovered : q.text.first)}</p>
    {!r.helped && <p class="story">{L((g.meta.npcMeetings[q.npc] ?? 0) > 1 ? q.text.familiar : q.text.greeting)}</p>}
    {r.variant === "first" && !r.helped && <>
      {water.length ? <label class="person-water">{U("personWaterChoice")}<select value={selected?.key ?? ""} onChange={e => setWaterKey((e.target as HTMLSelectElement).value)}>{water.map(x => <option key={x.key} value={x.key}>{L(g.itemName(x))}</option>)}</select></label> : <p class="muted small">{L(q.text.noWater)}</p>}
    </>}
    {g.personChoices().map(({ ch, ok }) => <button key={ch.id} class="opt" disabled={!ok} onClick={() => act({ type: "roomPersonChoice", id: ch.id, waterKey: ch.requires ? selected?.key : undefined })}>
      <span>{L(ch.text)}{ch.requires && selected && <small>{L(g.itemName(selected))}</small>}</span>
      <small>{ok ? ch.minutes ? U("minutes", { m: ch.minutes }) : "" : L(q.text.noWater)}</small>
    </button>)}
    <button class="opt" onClick={close}>{U("personBack")}</button>
    <p class="story" aria-live="polite">{L(g.run.log[g.run.log.length - 1]?.t ?? q.text.first)}</p>
  </>;
}
