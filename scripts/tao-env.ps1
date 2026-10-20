# Tao file .env cho tuvung-api va tuvung-react tu .env.example (PostgreSQL o cong 5433).
# Da co .env thi giu nguyen, khong ghi de.
param([int]$Port = 5433)
$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)

$api = Join-Path $root 'tuvung-api'
$apiEnv = Join-Path $api '.env'
if (Test-Path $apiEnv) {
  Write-Host "Da co $apiEnv - giu nguyen."
} else {
  $bytes = New-Object byte[] 48
  [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
  $secret = [Convert]::ToBase64String($bytes).Replace('+', '-').Replace('/', '_').TrimEnd('=')
  $lines = [IO.File]::ReadAllLines((Join-Path $api '.env.example')) | ForEach-Object {
    if ($_ -match '^JWT_ACCESS_SECRET=') { "JWT_ACCESS_SECRET=$secret" }
    elseif ($_ -match '^DATABASE_URL=') { $_ -replace 'localhost:\d+/', "localhost:$Port/" }
    else { $_ }
  }
  [IO.File]::WriteAllLines($apiEnv, [string[]]$lines)
  Write-Host "Da tao $apiEnv (database o cong $Port)."
}

$web = Join-Path $root 'tuvung-react'
$webEnv = Join-Path $web '.env'
if (Test-Path $webEnv) {
  Write-Host "Da co $webEnv - giu nguyen."
} else {
  Copy-Item (Join-Path $web '.env.example') $webEnv
  Write-Host "Da tao $webEnv."
}
