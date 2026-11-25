import type { RecordEntry } from '../shared/domain';
// Plain-language explanation of a record for visitors without technical knowledge.
// Only translates what is stored; never adds meaning that the record does not contain.
const who: Record<string, string> = {
  criatura: 'Uma decisão da própria criatura.',
  motor: 'Registro automático da simulação.',
  simulacao_deterministica: 'Registro automático: o tempo passou e a atividade terminou (regra da simulação, não uma escolha).',
  observacao: 'Resumo automático do que aconteceu neste momento.',
  regra_afetiva: 'Reação emocional calculada por uma regra da simulação (não é um sentimento declarado por ela).',
  consolidacao_deterministica: 'Resumo automático feito enquanto ela descansava, juntando lembranças.',
  observador: 'Mensagem deixada pelo responsável pelo observatório.',
  visitante: 'Mensagem deixada por um visitante do observatório.',
  homologacao: 'Registro de teste técnico.',
  homologacao_induzida: 'Registro de teste técnico, com instruções dadas a ela.',
  backup_interno: 'Cópia de segurança automática do estado.',
  controle_orcamento: 'Ajuste automático por causa do limite diário de uso da IA.',
};
const byKind: Record<string, string> = {
  intencao: 'O que ela pensou e decidiu neste momento (escrito por ela).',
  erro_ferramenta: 'Resultado de algo que ela tentou fazer.',
  erro: 'Aviso do sistema sobre uma pausa no pensamento dela.',
  corpo: 'O corpo dela reagiu sozinho (regra do corpo, não uma escolha dela).',
};
const tools: Record<string, string> = {
  atividade: 'fazer uma atividade (comer, beber, dormir…)',
  pesquisar: 'pesquisar na internet (Wikipedia, Wikidata, Wikcionário, Open Library, arXiv)',
  criar: 'criar uma obra',
  memoria: 'guardar uma lembrança',
  diario: 'escrever no diário',
  mensagem: 'deixar uma mensagem',
  identidade: 'decidir algo sobre si mesma',
  interesse: 'registrar um interesse',
  projeto: 'planejar ou atualizar um projeto',
  ler_obra: 'reler uma obra que fez',
  recordar: 'buscar lembranças antigas',
  relacionar: 'ligar duas ideias',
  mover: 'mudar um objeto de lugar',
  expor: 'expor uma obra',
  recurso: 'pedir um objeto novo',
  interromper: 'parar o que estava fazendo',
};
const activities: Record<string, string> = {
  comer: 'comer', beber: 'beber água', dormir: 'dormir', higiene: 'se limpar', descansar: 'descansar',
  observar: 'observar ao redor', organizar: 'organizar as coisas', pesquisar: 'pesquisar', criar: 'criar', diario: 'escrever no diário',
};
const errors: Record<string, string> = {
  evidencia_inexistente: 'ela se baseou em uma lembrança que não existe',
  acao_malformada: 'o pedido veio incompleto ou num formato inválido (por exemplo, sem dizer em que lembrança se baseava)',
  atividade_em_andamento: 'ela ainda estava ocupada com outra atividade',
  fila_de_atividades_cheia: 'já havia atividades demais planejadas',
  projeto_inexistente: 'o projeto citado não existe',
  obra_inexistente: 'a obra citada não existe',
  etapa_sem_artefato: 'quis marcar uma etapa como feita sem ter produzido a obra correspondente',
  conclusao_sem_resultado: 'quis concluir um projeto sem ter terminado todas as etapas',
  nome_permanente: 'tentou trocar de nome, mas o nome escolhido é permanente',
  mudanca_identidade_muito_rapida: 'tentou mudar algo sobre si cedo demais (no máximo uma vez por hora)',
  nova_evidencia_necessaria: 'para mudar de ideia, precisa de uma experiência nova que justifique',
  fonte_nao_consultada: 'disse ter aprendido algo numa pesquisa que não fez',
  fato_do_ambiente_sem_origem: 'chamou de fato algo que não veio do ambiente',
  relacao_sem_fonte: 'ligou duas ideias dizendo ter fonte, sem ter pesquisado',
  conceitos_invalidos: 'tentou ligar ideias que ainda não conhece',
  objeto_inacessivel: 'não conseguia chegar até o objeto',
  posicao_bloqueia_acesso: 'mudar o objeto ali bloquearia a passagem',
  pixels_invalidos: 'o desenho tinha um formato inválido',
  gemini_http_503: 'o serviço de IA estava sobrecarregado',
  gemini_fetch_timeouterror: 'o serviço de IA demorou demais para responder',
  gemini_response_zoderror: 'a resposta da IA veio num formato inválido',
  etapa_sem_evidencia: 'quis marcar uma etapa como feita sem apontar o trabalho que a cumpriu',
  ja_registrado: 'tentou registrar algo sobre si que já estava registrado',
  corpo_sem_condicoes: 'estava cansada, com fome ou com sede demais para esse esforço',
  sono_involuntario: 'tentou acordar, mas o corpo ainda estava exausto',
  orcamento_suspenso: 'o limite diário de pensamentos foi atingido',
  orcamento_global_suspenso: 'o limite diário de pensamentos foi atingido',
};
const memoryKind: Record<string, string> = {
  episodica: 'Lembrança de algo que viveu', semantica: 'Conhecimento', procedimental: 'Algo que aprendeu a fazer',
  afetiva: 'Lembrança emocional', autobiografica: 'Reflexão sobre a própria história', identidade: 'Algo sobre quem ela é',
  prospectiva: 'Plano para o futuro', trabalho: 'Nota para continuar o que estava fazendo',
};
const certainty: Record<string, string> = {
  fato_do_ambiente: 'um fato do mundo em que ela vive', observacao: 'algo que ela observou', hipotese: 'uma suposição',
  opiniao: 'uma opinião', ficcao: 'imaginação', incerto: 'algo de que ela não tem certeza', fonte_consultada: 'algo que aprendeu numa pesquisa',
};
const level = (v: number) => (v >= 0.75 ? 'alta' : v >= 0.45 ? 'média' : 'baixa');
const time = (ms: number) => new Date(ms).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
function lines(r: RecordEntry): string[] {
  const d = r.data as Record<string, unknown>;
  const out: string[] = [];
  switch (r.kind) {
    case 'intencao': {
      out.push(`O que ela pretendia: ${r.content}`);
      if (d.summary) out.push(`Por quê, nas palavras dela: ${String(d.summary)}`);
      const proposed = (d.proposed as string[] | undefined) ?? [];
      out.push(proposed.length ? `O que decidiu tentar: ${proposed.map((t) => tools[t] ?? t).join('; ')}.` : 'Decidiu não fazer nada além de observar.');
      if (d.nextMinutes) out.push(`Pediu para pensar de novo em cerca de ${String(d.nextMinutes)} minutos.`);
      if (typeof d.model === 'string') out.push(d.model.includes('lite') ? 'Pensamento do dia a dia (modelo rápido).' : 'Momento de reflexão mais profunda (modelo mais capaz).');
      break;
    }
    case 'erro_ferramenta': {
      const detail = d.detail as Record<string, unknown> | undefined;
      let why = errors[String(d.code)] ?? 'a ação não era possível naquele momento';
      if (d.code === 'atividade_em_andamento' && detail?.current) why = `ela ainda estava ocupada (${activities[String(detail.current)] ?? String(detail.current)})`;
      out.push(`Ela tentou ${tools[String(d.tool)] ?? String(d.tool)}, mas não deu certo: ${why}.`);
      out.push('Ela verá esse resultado na próxima vez que pensar e poderá tentar de outro jeito.');
      break;
    }
    case 'erro':
      out.push(`A mente dela ficou em pausa por um tempo: ${errors[String(d.code)] ?? 'um serviço externo falhou'}.`);
      if (d.nextAttempt) out.push(`Ela volta a pensar por volta das ${time(Number(d.nextAttempt))}. Nada foi inventado nesse intervalo.`);
      break;
    case 'atividade':
      out.push(r.content.includes('agendada') ? 'Deixou essa atividade para depois da atual.' : r.content.includes('continuada') ? 'Continuou o que já estava fazendo.' : 'Começou essa atividade.');
      break;
    case 'atividade_concluida':
      out.push('A atividade terminou porque o tempo dela passou. Comer, beber e dormir recuperam suas necessidades.');
      break;
    case 'memoria':
      out.push(`${memoryKind[r.category] ?? 'Lembrança'}.`);
      if (d.status) out.push(`Ela considera isso ${certainty[String(d.status)] ?? String(d.status)}.`);
      if (r.origin === 'criatura') out.push(`Certeza que ela declarou: ${level(r.confidence)}.`);
      break;
    case 'pesquisa': {
      const results = (d.results as unknown[] | undefined) ?? [];
      out.push(`Pesquisou “${String(d.query)}” e encontrou ${results.length} resultado(s)${d.cached ? ' (reaproveitando uma pesquisa recente)' : ''}. As fontes aparecem acima.`);
      out.push('O que ela leu pode estar errado: fontes não são verdades garantidas.');
      break;
    }
    case 'identidade':
      out.push(`Ela decidiu algo sobre si mesma (${String(d.field)}): “${r.content}”.`);
      break;
    case 'interesse':
      out.push(`Interesse em “${r.content}”, com força de ${Math.round(Number(d.strength ?? 0) * 100)}% (${String(d.status ?? 'ativo')}). Interesses esfriam com o tempo se não forem retomados.`);
      break;
    case 'projeto': {
      const steps = (d.steps as string[] | undefined) ?? [];
      const done = (d.completed as number[] | undefined) ?? [];
      out.push(`Projeto “${r.content}”: ${done.length} de ${steps.length} etapa(s) feitas, situação: ${String(d.status ?? '')}.`);
      break;
    }
    case 'artefato':
      out.push(`Uma obra criada por ela${d.version && Number(d.version) > 1 ? ` (versão ${String(d.version)}, ela revisou)` : ''}.`);
      if (d.motivation) out.push(`Motivo que ela deu: ${String(d.motivation)}`);
      break;
    case 'leitura':
      out.push(r.content.startsWith('Leitura') ? 'Ela releu uma obra que fez, para continuar ou revisar.' : 'Ela procurou lembranças antigas sobre um assunto.');
      break;
    case 'comportamento': {
      const counts = (d.counts as Record<string, number> | undefined) ?? {};
      const top = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, v]) => `${activities[k] ?? k} (${v})`);
      out.push(`O que ela mais fez ultimamente, contado pela simulação: ${top.join(', ')}.`);
      break;
    }
    case 'conversa':
      out.push(d.role === 'criatura' ? 'Mensagem escrita por ela para quem observa.' : 'Mensagem recebida. Ela decide se responde, adia ou ignora.');
      break;
    case 'interrupcao':
      out.push('O sistema ficou um tempo sem rodar. O tempo dela foi ajustado sem inventar o que teria acontecido.');
      break;
  }
  if (r.associations.length) out.push(`Baseado em ${r.associations.length} registro(s) anteriores ligados a este.`);
  return out;
}
export function Explanation({ record }: { record: RecordEntry }) {
  const text = lines(record);
  return (
    <details className="plain-explanation">
      <summary>Entenda este registro</summary>
      <p className="plain-who">{byKind[record.kind] ?? who[record.origin] ?? 'Registro do sistema.'}</p>
      {text.map((line, i) => (
        <p key={i}>{line}</p>
      ))}
      <details className="technical-details">
        <summary>Detalhes técnicos</summary>
        <p className="record-id">
          {record.id} · {record.origin}
        </p>
        <p>
          Importância {Math.round(record.importance * 100)}% · confiança declarada {Math.round(record.confidence * 100)}%
        </p>
        <pre>{JSON.stringify(record.data, null, 2)}</pre>
        {record.associations.length ? <p>Associações: {record.associations.join(', ')}</p> : null}
      </details>
    </details>
  );
}
