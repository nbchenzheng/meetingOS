[CmdletBinding()]
param(
    [string]$CredentialFile,
    [int]$ApiPort = 3031,
    [int]$WebPort = 5173,
    [switch]$Install
)
$ErrorActionPreference = 'Stop'
$meetingRepo = Split-Path -Parent $PSScriptRoot
if (-not (Get-Command node -ErrorAction SilentlyContinue) -or
    -not (Get-Command npm.cmd -ErrorAction SilentlyContinue)) {
    throw 'Install Node.js 24 or newer, then reopen PowerShell.'
}
$meetingNodeMajor = & node -p "Number(process.versions.node.split('.')[0])"
if ($LASTEXITCODE -ne 0 -or [int]$meetingNodeMajor -lt 24) { throw 'MeetingOS requires Node.js 24 or newer.' }
foreach ($meetingPort in @($ApiPort, $WebPort)) {
    if ($meetingPort -lt 1024 -or $meetingPort -gt 65535) { throw 'Ports must be between 1024 and 65535.' }
    $meetingProbe = New-Object System.Net.Sockets.TcpClient
    try {
        $meetingConnect = $meetingProbe.ConnectAsync('127.0.0.1', $meetingPort)
        if ($meetingConnect.Wait(300) -and $meetingProbe.Connected) {
            throw "Port $meetingPort is occupied. Select another -ApiPort or -WebPort; do not stop unknown processes."
        }
    } catch [System.AggregateException] {
        # Connection refused means the port is available.
    } finally { $meetingProbe.Dispose() }
}
if ($ApiPort -eq $WebPort) { throw 'API and web ports must be different.' }
$meetingNames = @('PORT', 'VITE_PORT', 'NODE_ENV', 'MEETINGOS_PUBLIC_URL', 'AI_BOARD_DATA_DIR',
    'LINKHARBOR_API_KEY', 'LINKHARBOR_BASE_URL', 'WEI_LLM_API_KEY', 'WEI_LLM_BASE_URL',
    'MEETINGOS_GPT_MODEL', 'MEETINGOS_CLAUDE_MODEL', 'MEETINGOS_GEMINI_MODEL', 'MEETINGOS_DEEPSEEK_MODEL',
    'ALIYUN_ASR_API_KEY', 'ALIYUN_ASR_ENABLED', 'ALIYUN_ASR_MODEL', 'ALIYUN_ASR_WS_URL', 'ALIYUN_ASR_REGION')
$meetingPrevious = @{}
foreach ($meetingName in $meetingNames) { $meetingPrevious[$meetingName] = [Environment]::GetEnvironmentVariable($meetingName, 'Process') }
Push-Location $meetingRepo
try {
    if ($CredentialFile) {
        $meetingCredentialPath = (Resolve-Path -LiteralPath $CredentialFile).Path
        $meetingLines = @([IO.File]::ReadAllLines($meetingCredentialPath) | ForEach-Object { $_.Trim() } | Where-Object { $_ })
        for ($meetingIndex = 0; $meetingIndex -lt $meetingLines.Count; $meetingIndex++) {
            $meetingUrl = $meetingLines[$meetingIndex]
            if ($meetingUrl -notmatch '^https://') { continue }
            if ($meetingIndex + 1 -ge $meetingLines.Count -or $meetingLines[$meetingIndex + 1] -match '^https://') {
                throw 'Each URL in the credential file must be followed by its key.'
            }
            $meetingSecret = $meetingLines[$meetingIndex + 1]
            if ($meetingUrl.TrimEnd('/') -eq 'https://api.wei.run/v1') { $env:WEI_LLM_API_KEY = $meetingSecret }
            elseif ($meetingUrl.TrimEnd('/') -eq 'https://api.linkharbor.ai/v1') { $env:LINKHARBOR_API_KEY = $meetingSecret }
            elseif ($meetingUrl -match '^https://[a-z0-9-]+\.cn-beijing\.maas\.aliyuncs\.com/compatible-mode/v1/?$') {
                $env:ALIYUN_ASR_API_KEY = $meetingSecret
            }
        }
        $meetingSecret = $null
        $meetingLines = $null
    }
    $env:PORT = [string]$ApiPort
    $env:VITE_PORT = [string]$WebPort
    $env:NODE_ENV = 'development'
    $env:MEETINGOS_PUBLIC_URL = ''
    if (-not $env:LOCALAPPDATA) { throw 'Windows LOCALAPPDATA is unavailable.' }
    $env:AI_BOARD_DATA_DIR = Join-Path $env:LOCALAPPDATA 'MeetingOS\development'
    $env:WEI_LLM_BASE_URL = 'https://api.wei.run/v1'
    $env:MEETINGOS_DEEPSEEK_MODEL = 'deepseek-v4-flash'
    $env:LINKHARBOR_BASE_URL = 'https://api.linkharbor.ai/v1'
    if (-not $env:MEETINGOS_GPT_MODEL) { $env:MEETINGOS_GPT_MODEL = 'gpt-5.6-sol-lh1' }
    if (-not $env:MEETINGOS_CLAUDE_MODEL) { $env:MEETINGOS_CLAUDE_MODEL = 'claude-opus-4-8-aws' }
    if (-not $env:MEETINGOS_GEMINI_MODEL) { $env:MEETINGOS_GEMINI_MODEL = 'gemini-3.7-flash' }
    $env:ALIYUN_ASR_ENABLED = if ($env:ALIYUN_ASR_API_KEY) { 'true' } else { 'false' }
    $env:ALIYUN_ASR_WS_URL = 'wss://dashscope.aliyuncs.com/api-ws/v1/inference'
    $env:ALIYUN_ASR_MODEL = 'fun-asr-realtime'
    $env:ALIYUN_ASR_REGION = 'cn-beijing'
    if ($Install -or -not (Test-Path -LiteralPath (Join-Path $meetingRepo 'node_modules'))) {
        & npm.cmd ci --ignore-scripts --no-audit --no-fund
        if ($LASTEXITCODE -ne 0) { throw 'Dependency installation failed.' }
    }
    Write-Host "Local development: web port $WebPort, API port $ApiPort. Press Ctrl+C to stop."
    Write-Host 'DeepSeek Flash: wei.run. GPT/Claude/Gemini: LinkHarbor. ASR: Aliyun Bailian.'
    Write-Host 'Keys are loaded into the process environment only, never .env or Git.'
    & npm.cmd run dev
    if ($LASTEXITCODE -ne 0) { throw 'Local startup failed. Check the errors above.' }
} finally {
    foreach ($meetingName in $meetingNames) { [Environment]::SetEnvironmentVariable($meetingName, $meetingPrevious[$meetingName], 'Process') }
    Pop-Location
}
