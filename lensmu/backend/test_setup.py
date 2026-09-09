"""Setup command failures must never become a successful installation."""

import pathlib
import shutil
import subprocess
import sys

import pytest

SETUP = pathlib.Path(__file__).resolve().parents[2] / "setup.ps1"
PWSH = shutil.which("pwsh")
pytestmark = pytest.mark.skipif(PWSH is None, reason="PowerShell is not installed")


def ps_quote(value):
    return "'" + str(value).replace("'", "''") + "'"


def test_checked_runner_propagates_native_exit():
    script = f"""
        . {ps_quote(SETUP)}
        try {{
            Invoke-CheckedCommand -File {ps_quote(sys.executable)} -Arguments @('-c', 'import sys; sys.exit(7)')
            exit 99
        }} catch {{
            if ($_.Exception.Message -notmatch 'exit code 7') {{ exit 98 }}
            Write-Output 'native-failure-observed'
        }}
    """
    result = subprocess.run([PWSH, "-NoProfile", "-NonInteractive", "-Command", script], capture_output=True, text=True)
    assert result.returncode == 0, result.stderr
    assert "native-failure-observed" in result.stdout


def test_build_failure_restores_directory_and_never_claims_success(tmp_path):
    (tmp_path / "lensmu" / "extension").mkdir(parents=True)
    (tmp_path / "lensmu" / "backend").mkdir()
    script = f"""
        . {ps_quote(SETUP)}
        function Get-Command {{ param($Name, $ErrorAction); [pscustomobject]@{{ Source = 'npm.cmd' }} }}
        function Invoke-CheckedCommand {{
            param($File, $Arguments)
            if ($Arguments[0] -eq 'run') {{ throw 'simulated-build-failure' }}
        }}
        $before = (Get-Location).Path
        try {{ Invoke-VisionTranslateSetup -RepositoryRoot {ps_quote(tmp_path)} -OcrProfile 'core'; exit 99 }}
        catch {{ if ($_.Exception.Message -notmatch 'simulated-build-failure') {{ throw }} }}
        if ((Get-Location).Path -ne $before) {{ exit 98 }}
        Write-Output 'directory-restored'
    """
    result = subprocess.run([PWSH, "-NoProfile", "-NonInteractive", "-Command", script], capture_output=True, text=True)
    assert result.returncode == 0, result.stderr
    assert "directory-restored" in result.stdout
    assert "Setup complete" not in result.stdout
