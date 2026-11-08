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
