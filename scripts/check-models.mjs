// Read secret only from environment; do not print headers, bodies, or credentials.
const key = process.env.GEMINI_API_KEY;
if (!key) {
  console.error(
    'Defina GEMINI_API_KEY apenas no ambiente desta sessão. Nenhuma chamada foi feita.',
  );
  process.exit(1);
}
for (const model of ['gemini-3.1-flash-lite', 'gemini-3-flash-preview']) {
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}`, {
    headers: { 'x-goog-api-key': key },
    redirect: 'error',
    signal: AbortSignal.timeout(15000),
  });
  console.log(`${model}: HTTP ${response.status}`);
  if (!response.ok) process.exitCode = 1;
}
console.log(
  'Consulta de disponibilidade apenas; confira RPM/TPM/RPD e projeto Free sem faturamento no AI Studio. Geração real ainda não homologada.',
);
