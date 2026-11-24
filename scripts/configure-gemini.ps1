$ErrorActionPreference = 'Stop'
$privateDirectory = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../.wrangler/private'))
New-Item -ItemType Directory -Force -Path $privateDirectory | Out-Null
$confirmation = Read-Host 'Confirma que o projeto Gemini esta no nivel Free e sem faturamento vinculado? Digite FREE somente apos conferir o AI Studio'
if ($confirmation -cne 'FREE') { throw 'Confirmacao Free nao fornecida. Nenhuma chave foi armazenada.' }
$geminiSecret = Read-Host 'Cole a chave Gemini (entrada oculta, nao sera registrada no historico)' -AsSecureString
if ($geminiSecret.Length -lt 20) { throw 'Chave vazia ou curta demais.' }
$encryptedSecret = ConvertFrom-SecureString -SecureString $geminiSecret
Set-Content -LiteralPath (Join-Path $privateDirectory 'gemini.dpapi') -Value $encryptedSecret -Encoding UTF8
@{ confirmed = $true; at = [DateTimeOffset]::UtcNow.ToString('o'); source = 'explicit-user-confirmation'; scope = 'Gemini Free sem faturamento vinculado' } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $privateDirectory 'free-confirmation.json') -Encoding UTF8
$geminiSecret.Dispose()
Write-Output 'Chave protegida pelo Windows DPAPI. Confirmacao registrada. Avise no chat: configurado.'
