# =============================================================================
# PreToolUse guard — asks before commands that touch live infra, spend money,
# or make something publicly reachable.
#
# Receives the tool invocation as JSON on stdin. Exits 0 always; when a risky
# pattern matches it emits a permissionDecision of "ask" so the agent prompts
# the user before the command runs.
# =============================================================================

$ErrorActionPreference = 'Stop'

try {
    $raw = [Console]::In.ReadToEnd()
    if ([string]::IsNullOrWhiteSpace($raw)) { exit 0 }

    $payload = $raw | ConvertFrom-Json

    # The command lives under the tool input; field name varies by tool version.
    $command = $null
    foreach ($candidate in @('command', 'cmd', 'script')) {
        if ($payload.toolInput -and $payload.toolInput.PSObject.Properties.Name -contains $candidate) {
            $command = [string]$payload.toolInput.$candidate
            break
        }
        if ($payload.input -and $payload.input.PSObject.Properties.Name -contains $candidate) {
            $command = [string]$payload.input.$candidate
            break
        }
    }

    if ([string]::IsNullOrWhiteSpace($command)) { exit 0 }

    # Pattern => human-readable reason
    $risky = [ordered]@{
        'npm\s+publish'                 = 'publica el paquete en el registro npm'
        'git\s+push\s+.*--force'        = 'reescribe historia remota (force push)'
        'git\s+push\s+.*-f(\s|$)'       = 'reescribe historia remota (force push)'
        'git\s+reset\s+--hard'          = 'descarta cambios locales de forma irreversible'
        'git\s+clean\s+-[a-z]*f'        = 'borra archivos sin seguimiento de forma irreversible'
        '(^|\s)aws\s'                   = 'opera sobre recursos de AWS reales'
        'firebase\s+deploy'             = 'despliega a Firebase en produccion'
        '(^|\s)vercel(\s|$)'            = 'despliega a Vercel'
        'netlify\s+deploy'              = 'despliega a Netlify'
        'wrangler\s+(deploy|publish)'   = 'despliega a Cloudflare'
        'electron-builder.*--publish'   = 'publica el instalador de escritorio'
        'gh\s+release\s+create'         = 'crea un release publico en GitHub'
    }

    foreach ($pattern in $risky.Keys) {
        if ($command -match $pattern) {
            $reason = "Este comando $($risky[$pattern]). Reviselo antes de continuar."
            $decision = @{
                hookSpecificOutput = @{
                    permissionDecision       = 'ask'
                    permissionDecisionReason = $reason
                }
            }
            $decision | ConvertTo-Json -Compress -Depth 5
            exit 0
        }
    }

    exit 0
}
catch {
    # Never block work because the guard itself failed.
    exit 0
}
