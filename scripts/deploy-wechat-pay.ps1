param(
  [string]$ProjectRef = "rtlebdivzzmqnushmaeo"
)

$ErrorActionPreference = "Stop"

$Root = Resolve-Path (Join-Path $PSScriptRoot "..")
$SecretsFile = Join-Path $Root "supabase\.env.wechat.local"
$AccessTokenFile = Join-Path $Root "supabase\.supabase-access-token.local"
$LocalSupabaseCli = Join-Path $Root "..\..\.tools\supabase-cli\supabase.exe"

$RequiredSecrets = @(
  "WECHAT_PAY_MCH_ID",
  "WECHAT_PAY_APP_ID",
  "WECHAT_PAY_CERT_SERIAL_NO",
  "WECHAT_PAY_PRIVATE_KEY",
  "WECHAT_PAY_API_V3_KEY",
  "WECHAT_PAY_PLATFORM_PUBLIC_KEY",
  "WECHAT_PAY_NOTIFY_URL",
  "GBP_TO_CNY_RATE"
)

$SupabaseCommand = Get-Command supabase -ErrorAction SilentlyContinue
if ($SupabaseCommand) {
  $SupabaseCli = $SupabaseCommand.Source
} elseif (Test-Path $LocalSupabaseCli) {
  $SupabaseCli = (Resolve-Path $LocalSupabaseCli).Path
} else {
  throw "Supabase CLI is not installed. Install it first, then rerun this script."
}

if (-not (Test-Path $SecretsFile)) {
  throw "Missing secrets file: $SecretsFile"
}

$SecretMap = @{}
foreach ($Line in Get-Content $SecretsFile) {
  $Trimmed = $Line.Trim()
  if (-not $Trimmed -or $Trimmed.StartsWith("#")) {
    continue
  }

  $Index = $Trimmed.IndexOf("=")
  if ($Index -le 0) {
    continue
  }

  $Name = $Trimmed.Substring(0, $Index).Trim()
  $Value = $Trimmed.Substring($Index + 1).Trim()
  $SecretMap[$Name] = $Value
}

foreach ($Name in $RequiredSecrets) {
  if (-not $SecretMap.ContainsKey($Name) -or -not $SecretMap[$Name] -or $SecretMap[$Name] -match "REPLACE_ME|your ") {
    throw "Please fill a real value for $Name in $SecretsFile"
  }
}

if (-not $env:SUPABASE_ACCESS_TOKEN -and (Test-Path $AccessTokenFile)) {
  $env:SUPABASE_ACCESS_TOKEN = (Get-Content $AccessTokenFile -Raw).Trim()
}

if (-not $env:SUPABASE_ACCESS_TOKEN -or $env:SUPABASE_ACCESS_TOKEN -match "REPLACE_ME|your ") {
  throw "Missing SUPABASE_ACCESS_TOKEN. Set it as an environment variable or put it in $AccessTokenFile"
}

& $SupabaseCli secrets set --env-file $SecretsFile --project-ref $ProjectRef
& $SupabaseCli functions deploy create-wechat-native-order --project-ref $ProjectRef
& $SupabaseCli functions deploy wechat-pay-notify --project-ref $ProjectRef

Write-Host "WeChat Pay Edge Functions deployed for project $ProjectRef."
