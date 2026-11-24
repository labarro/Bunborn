import { useEffect, useRef } from 'react';
import { createHabitat } from './habitat';
import type { HabitatObject, State } from '../shared/domain';
export default function HabitatView({
  state,
  onSelect,
}: {
  state: State | null;
  onSelect: (o: HabitatObject) => void;
}) {
  const parent = useRef<HTMLDivElement>(null);
  const engine = useRef<ReturnType<typeof createHabitat> | null>(null);
  const select = useRef(onSelect);
  select.current = onSelect;
  useEffect(() => {
    if (!parent.current) return;
    const instance = createHabitat(parent.current, (o) => select.current(o));
    engine.current = instance;
    return () => {
      engine.current = null;
      instance.game.destroy(true);
    };
  }, []);
  useEffect(() => {
    engine.current?.scene.apply(state);
  }, [state]);
  return (
    <div
      className="phaser-host"
      ref={parent}
      role="img"
      aria-label={
        state
          ? `Habitat do coelho ${state.identity.name ?? 'sem nome'}. Atividade registrada: ${state.activity.kind}.`
          : 'Habitat isométrico vazio, preparado para o nascimento.'
      }
    />
  );
}
