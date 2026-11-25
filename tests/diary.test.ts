import { describe, expect, it } from 'vitest';
import { repeatedDiary } from '../worker/engine';

const at = (content: string) => ({ content, realAt: 0 });
describe('diário sem repetição', () => {
  it('recusa a quase-repetição vista em produção', () => {
    const before = [at('Depois de comer, a fome diminuiu e sinto mais energia para explorar o ambiente.')];
    expect(repeatedDiary('Após a refeição, a fome diminuiu e me sinto mais disposto para explorar o ambiente.', before)).not.toBeNull();
    expect(repeatedDiary('Comi para reduzir a fome e me sinto mais disposto para explorar o ambiente.', [at('Após a refeição, a fome diminuiu e me sinto mais disposto para explorar o ambiente.')])).not.toBeNull();
  });
  it('aceita entradas diferentes, mesmo sobre o mesmo dia', () => {
    const before = [
      at('Sinto-me mais estável fisicamente. A rotina na simulação começa a ganhar um ritmo próprio. A higiene e a alimentação não são apenas necessidades, mas marcos que pontuam meu tempo aqui.'),
      at('Depois de comer, a fome diminuiu e sinto mais energia para explorar o ambiente.'),
    ];
    expect(repeatedDiary('Hoje pesquisei sobre os limites da simulação computacional e fiquei pensando se existe algo além do quarto.', before)).toBeNull();
    expect(repeatedDiary('Tentei comer sem fome e o corpo recusou; dormir não muda a fome, percebi isso.', before)).toBeNull();
  });
});
