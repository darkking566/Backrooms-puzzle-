import { useState } from "preact/hooks";
import type { Command } from "../core/game";
import { SYMBOLS } from "../systems/symbol-lock";
import { ctx, L, U } from "./ctx";

export function LockedPackPanel({ act }: { act: (cmd: Command) => void }) {
  // Turning a wheel is thought, not an action. Closing/reloading resets all three.
  const [code, setCode] = useState([0, 0, 0]);
  const g = ctx.game!, p = g.run.lockedPack, def = g.packPuzzle;
  if (!p || !g.canReachPack()) return <p>{U("tooFar")}</p>;
  const turn = (k: number, delta: number) => setCode(old => old.map((n, i) => i === k ? (n + delta + 10) % 10 : n));
  return <>
    <p class="story">{L(def.text.description)}</p>
    <div class="paper"><p>{U("packTag")}：<strong class="lock-symbols">{p.order.map(s => SYMBOLS[s]).join(" ")}</strong></p>
      {p.hasRuleNote && <p>{L(def.text.ruleNote)}</p>}
      {p.marksSeen ? <><p>{U("packMarks")}</p>{p.marksOrder.map(s => <p key={s}><b>{SYMBOLS[s]}</b>　{p.numbers[s] ? "│".repeat(p.numbers[s]) : "[ ]"}　<small>{p.numbers[s] ? U("packCount", { n: p.numbers[s] }) : U("packZero")}</small></p>)}</>
        : <button class="opt" onClick={() => act({ type: "packMarks" })}>{U("packExamineMarks")}<small>{U("minutes", { m: def.minutes.examineMarks })}</small></button>}
    </div>
    {!p.openedBy ? <>
      <div class="lock-dials">{code.map((n, k) => <div key={k} role="group" aria-label={U("packDigit", { n: k + 1 })}>
        <button aria-label={U("packIncrease", { n: k + 1 })} onClick={() => turn(k, 1)}>＋</button>
        <output aria-live="polite">{n}</output>
        <button aria-label={U("packDecrease", { n: k + 1 })} onClick={() => turn(k, -1)}>−</button>
      </div>)}</div>
      {p.jammed ? <><p class="story">{L(def.text.jammed)}</p><button class="opt" onClick={() => act({ type: "packUnjam" })}>{U("packUnjam")}<small>{U("minutes", { m: def.minutes.unjam })}</small></button></>
        : <button class="opt" onClick={() => act({ type: "packAttempt", code })}>{U("packAttempt")}<small>{U("minutes", { m: def.minutes.attempt })}</small></button>}
      <button class="opt" disabled={!g.has("crowbar")} onClick={() => act({ type: "packForce" })}>{U("packForce")}<small>{g.has("crowbar") ? U("minutes", { m: def.minutes.force }) : U("needs", { x: L(g.item("crowbar").name) })}</small></button>
    </> : <>
      <p class="story">{L(def.text.inside)}</p><div class="paper"><p>{L(def.text.paper)}</p></div>
      {p.items.length ? p.items.map(x => <button class="opt" key={x.key} onClick={() => act({ type: "packTake", key: x.key })}>{L(g.itemName(x))}<small>{U("take")}</small></button>) : <p>{L(def.text.empty)}</p>}
    </>}
    <p class="story" aria-live="polite">{L(g.run.log[g.run.log.length - 1]?.t ?? def.text.description)}</p>
  </>;
}
