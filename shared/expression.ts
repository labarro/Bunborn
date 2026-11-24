import type { State } from './domain';
// Visual expression derived ONLY from the simulated state the engine already records.
// It is a readable projection of needs/motives, never a feeling claimed by the model.
export type ExpressionKey =
  | 'dormindo'
  | 'sonolenta'
  | 'sedenta'
  | 'faminta'
  | 'frustrada'
  | 'contente'
  | 'curiosa'
  | 'entediada'
  | 'neutra';
export type Expression = { key: ExpressionKey; label: string; reason: string };
const n = (v: number | undefined) => Math.round(v ?? 0);
export function isActive(state: State) {
  return state.activity.until > state.virtualMinutes;
}
export function expressionFor(state: State): Expression {
  const { needs: need, motives: motive } = state;
  if (isActive(state) && state.activity.kind === 'dormir')
    return { key: 'dormindo', label: 'Dormindo', reason: 'atividade registrada: dormir' };
  if ((need.sono ?? 0) >= 75 || (need.energia ?? 100) <= 25)
    return { key: 'sonolenta', label: 'Sonolenta', reason: `sono ${n(need.sono)}, energia ${n(need.energia)}` };
  if ((need.sede ?? 0) >= 75) return { key: 'sedenta', label: 'Com sede', reason: `sede ${n(need.sede)}` };
  if ((need.fome ?? 0) >= 75) return { key: 'faminta', label: 'Com fome', reason: `fome ${n(need.fome)}` };
  if ((motive.frustracao ?? 0) >= 60)
    return { key: 'frustrada', label: 'Frustrada', reason: `frustração ${n(motive.frustracao)}` };
  if ((motive.satisfacao ?? 0) >= 70 && (need.conforto ?? 0) >= 60)
    return { key: 'contente', label: 'Contente', reason: `satisfação ${n(motive.satisfacao)}, conforto ${n(need.conforto)}` };
  if ((motive.curiosidade ?? 0) >= 70)
    return { key: 'curiosa', label: 'Curiosa', reason: `curiosidade ${n(motive.curiosidade)}` };
  if ((motive.tedio ?? 0) >= 70) return { key: 'entediada', label: 'Entediada', reason: `tédio ${n(motive.tedio)}` };
  return { key: 'neutra', label: 'Tranquila', reason: 'necessidades e motivações em faixa moderada' };
}
