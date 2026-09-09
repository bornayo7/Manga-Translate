param(
    [ValidateSet('core', 'ocr2', 'ocr3')]
    [string]$Profile = 'ocr2'
)

$ErrorActionPreference = 'Stop'

function Invoke-CheckedCommand {
    param([string]$File, [string[]]$Arguments)
    & $File @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "Command failed with exit code ${LASTEXITCODE}: $File $($Arguments -join ' ')"
    }
}

function Invoke-VisionTranslateSetup {
    param([string]$RepositoryRoot, [string]$OcrProfile)
    $backendDir = Join-Path $RepositoryRoot 'lensmu\backend'
    $extensionDir = Join-Path $RepositoryRoot 'lensmu\extension'
    $venvDir = Join-Path $backendDir 'venv'
    $pythonPath = Join-Path $venvDir 'Scripts\python.exe'
    $requirements = @{
        core = 'requirements.txt'
        ocr2 = 'requirements-ocr.txt'
        ocr3 = 'requirements-ocr3.txt'
    }[$OcrProfile]

    Get-Command py -ErrorAction Stop | Out-Null
    Get-Command node -ErrorAction Stop | Out-Null
    $npmCommand = (Get-Command npm.cmd -ErrorAction Stop).Source
    Invoke-CheckedCommand -File 'py' -Arguments @('-3.12', '--version')
    Invoke-CheckedCommand -File 'node' -Arguments @('-e', 'if (Number(process.versions.node.split(".")[0]) < 20 || (Number(process.versions.node.split(".")[0]) === 20 && Number(process.versions.node.split(".")[1]) < 19)) process.exit(1)')

    if (-not (Test-Path -LiteralPath $pythonPath)) {
        Invoke-CheckedCommand -File 'py' -Arguments @('-3.12', '-m', 'venv', $venvDir)
    }
    Invoke-CheckedCommand -File $pythonPath -Arguments @('-c', 'import sys; assert sys.version_info[:2] == (3, 12), "Use a Python 3.12 virtual environment."')
    Write-Host "Installing the $OcrProfile backend profile..."
    Invoke-CheckedCommand -File $pythonPath -Arguments @('-m', 'pip', 'install', '-r', (Join-Path $backendDir $requirements))
    Invoke-CheckedCommand -File $pythonPath -Arguments @('-m', 'pip', 'check')

    Push-Location -LiteralPath $extensionDir
    try {
        Invoke-CheckedCommand -File $npmCommand -Arguments @('ci')
        Invoke-CheckedCommand -File $npmCommand -Arguments @('run', 'build')
    } finally {
        Pop-Location
    }
    Write-Host 'Setup complete.'
    Write-Host "Start the backend: & '$pythonPath' '$backendDir\server.py'"
    Write-Host "Load unpacked in chrome://extensions: $extensionDir"
}

# Dot-sourcing exposes the checked runner for tests without starting setup.
if ($MyInvocation.InvocationName -ne '.') {
    try {
        Invoke-VisionTranslateSetup -RepositoryRoot $PSScriptRoot -OcrProfile $Profile
    } catch {
        Write-Error "Setup failed: $_. Install Python 3.12 and Node.js 20.19+ if missing."
        exit 1
    }
}
