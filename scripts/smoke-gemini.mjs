import { z } from 'zod';
import { decisionSchema } from '../shared/domain.ts';
const key = process.env.GEMINI_API_KEY;
if (!key || process.env.FREE_TIER_CONFIRMED !== 'true') {
  console.error(
    'Configure GEMINI_API_KEY em ambiente e confirme FREE_TIER_CONFIRMED=true após verificar projeto Free sem faturamento. Zero chamadas feitas.',
  );
  process.exit(1);
}
const schema = z.toJSONSchema(decisionSchema);
delete schema.$schema;
for (const model of ['gemini-3.1-flash-lite', 'gemini-3-flash-preview']) {
  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
        redirect: 'error',
        signal: AbortSignal.timeout(30000),
        body: JSON.stringify({
          contents: [
            {
              parts: [
                {
                  text: 'Teste técnico isolado, fora de qualquer existência principal. Produza uma decisão JSON válida com intenção de observar, actions vazio, nextMinutes 5, complexNext false. Não invente experiências.',
                },
              ],
            },
          ],
          generationConfig: {
            responseMimeType: 'application/json',
            responseJsonSchema: schema,
            maxOutputTokens: 8192,
          },
        }),
      },
    );
    if (!response.ok) {
      console.log(`${model}: HTTP ${response.status}; sem retentativas.`);
      process.exitCode = 1;
      continue;
    }
    const data = await response.json();
    const parts = data.candidates?.[0]?.content?.parts ?? [];
    decisionSchema.parse(
      JSON.parse(
        parts
          .filter((p) => !p.thought)
          .map((p) => p.text ?? '')
          .join(''),
      ),
    );
    console.log(
      `${model}: JSON validado; ${data.usageMetadata?.totalTokenCount ?? 'desconhecido'} tokens reportados.`,
    );
  } catch {
    console.log(`${model}: falha de transporte ou validação; nenhum conteúdo privado exibido.`);
    process.exitCode = 1;
  }
}
console.log(
  'Até 2 chamadas reais. Isso verifica transporte/contrato, não cota diária nem emergência comportamental.',
);
