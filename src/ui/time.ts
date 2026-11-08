/* One duration is shared by the clock delta, the passing-time overlay and waking from rest. */
import { T, type Text } from "../core/types";
import { vagueDuration } from "../systems/hallucinations";

export function elapsedMessages(minutes: number, watch: boolean, perceived?: Text) {
  let duration: Text;
  if (watch) {
    const h = Math.floor(minutes / 60), m = minutes % 60;
    duration = h ? T(`${h} 小時${m ? ` ${m} 分鐘` : ""}`, `${h} h${m ? ` ${m} min` : ""}`) : T(`${minutes} 分鐘`, `${minutes} min`);
  } else duration = perceived ?? vagueDuration(minutes);
  return {
    duration,
    delta: T("+" + duration.zh, "+" + duration.en),
    passed: T(`……過了${duration.zh}。`, `...Time passes: ${duration.en}.`),
    slept: T(`……你醒了過來。睡了${duration.zh}。`, `...You wake. You slept ${duration.en}.`)
  };
}

/** How long the dimmed "time passes" overlay stays up: longer waits feel longer (15 min ≈ 1.5 s, 1 h ≈ 2.3 s, 8 h ≈ 3.5 s). */
export function skipMs(minutes: number) {
  return Math.round(Math.min(3600, Math.max(1500, 1500 + 400 * Math.log2(minutes / 15))));
}
