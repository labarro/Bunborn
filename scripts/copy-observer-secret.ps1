param([ValidateSet('production','homologation')][string]$Environment='production')
$ErrorActionPreference='Stop'
$file=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../.wrangler/private/generated-secrets.dpapi'))
$secure=(Get-Content -LiteralPath $file -Raw).Trim() | ConvertTo-SecureString
$pointer=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
try { $settings=[Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer) | ConvertFrom-Json; Set-Clipboard -Value $settings.$Environment.observer }
finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer); $secure.Dispose() }
Write-Output "Credencial do observador ($Environment) copiada. Cole apenas no formulario privado do Bunborn. Nenhum valor foi exibido."
