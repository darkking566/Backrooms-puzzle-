/* Shared runtime: content, the persistent meta state, the current game, the 3D view and the sound. */
import content from "virtual:content";
import type { Game } from "../core/game";
import type { Lang, Text } from "../core/types";
import { Audio } from "../render/audio";
import type { View } from "../render/view";
import { persist } from "../state/save";
import { newMeta, type Meta } from "../state/types";
import { tr, UI } from "../i18n/ui";

export const ctx = {
  content,
  meta: newMeta() as Meta,
  game: null as Game | null,
  view: null as View | null,
  audio: new Audio()
};
export const lang = (): Lang => ctx.meta.settings.lang;
export const L = (t: Text, p?: Record<string, string | number>) => tr(t, lang(), p);
export const U = (k: keyof typeof UI, p?: Record<string, string | number>) => tr(UI[k], lang(), p);
export function save() { return persist(ctx.meta, ctx.game ? ctx.game.save() : null); }
