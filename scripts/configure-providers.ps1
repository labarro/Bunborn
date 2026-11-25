$ErrorActionPreference = 'Stop'
# Stores the Groq and NVIDIA API keys encrypted with Windows DPAPI (current user only).
# Keys are typed with hidden input, never echoed, never written in plain text, never versioned.
# Run in your own terminal:  powershell -ExecutionPolicy Bypass -File scripts\configure-providers.ps1
$privateDirectory = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../.wrangler/private'))
New-Item -ItemType Directory -Force -Path $privateDirectory | Out-Null
$providers = @(
  @{ id = 'groq';   label = 'Groq (console.groq.com)';            file = 'groq.dpapi';   prefix = 'gsk_' },
  @{ id = 'nvidia'; label = 'NVIDIA API Catalog (build.nvidia.com)'; file = 'nvidia.dpapi'; prefix = 'nvapi-' }
)
$confirmation = Read-Host 'Confirma que as contas Groq e NVIDIA estao em planos gratuitos, sem cartao/faturamento vinculado? Digite FREE para continuar'
if ($confirmation -cne 'FREE') { throw 'Confirmacao Free nao fornecida. Nenhuma chave foi armazenada.' }
$stored = @()
foreach ($p in $providers) {
  $secret = Read-Host ("Cole a chave " + $p.label + " (entrada oculta; Enter vazio para pular)") -AsSecureString
  if ($secret.Length -eq 0) { Write-Output ("Pulado: " + $p.id); continue }
  if ($secret.Length -lt 20) { throw ("Chave " + $p.id + " curta demais.") }
  $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secret)
  try { $plain = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr) } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }
  if (-not $plain.StartsWith($p.prefix)) { Write-Output ("Aviso: a chave " + $p.id + " nao comeca com " + $p.prefix + " (verifique se e a chave certa).") }
  $plain = $null
  Set-Content -LiteralPath (Join-Path $privateDirectory $p.file) -Value (ConvertFrom-SecureString -SecureString $secret) -Encoding UTF8
  $secret.Dispose()
  $stored += $p.id
}
@{ confirmed = $true; at = [DateTimeOffset]::UtcNow.ToString('o'); source = 'explicit-user-confirmation'; providers = $stored; scope = 'Groq/NVIDIA em planos gratuitos sem faturamento' } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $privateDirectory 'providers-free-confirmation.json') -Encoding UTF8
Write-Output ('Chaves protegidas pelo Windows DPAPI: ' + ($stored -join ', ') + '. Avise no chat: configurado.')
