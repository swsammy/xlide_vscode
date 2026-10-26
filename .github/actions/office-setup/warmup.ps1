# Opens each Office app once, visibly, with a new file, and closes every
# first-run screen it shows, so later automation starts from a used profile.
$ErrorActionPreference = 'Continue'
Add-Type @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
public static class WarmDialogs {
    public delegate bool EnumProc(IntPtr hWnd, IntPtr lParam);
    [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc callback, IntPtr lParam);
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
    [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetClassName(IntPtr hWnd, StringBuilder text, int max);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int max);
    [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr hWnd, uint msg, IntPtr w, IntPtr l);
    public static List<string> CloseDialogs(uint pid) {
        var found = new List<string>();
        EnumWindows((hWnd, l) => {
            uint owner; GetWindowThreadProcessId(hWnd, out owner);
            if (owner != pid || !IsWindowVisible(hWnd)) { return true; }
            var c = new StringBuilder(256); GetClassName(hWnd, c, 256);
            if (c.ToString() != "#32770" && c.ToString() != "NUIDialog") { return true; }
            var t = new StringBuilder(1024); GetWindowText(hWnd, t, 1024);
            found.Add(c + " | " + t);
            PostMessage(hWnd, 0x0010, IntPtr.Zero, IntPtr.Zero);
            return true;
        }, IntPtr.Zero);
        return found;
    }
}
'@
$apps = @(
    @{ ProgId = 'Word.Application'; Image = 'WINWORD'; Open = { param($a) [void]$a.Documents.Add() } },
    @{ ProgId = 'PowerPoint.Application'; Image = 'POWERPNT'; Open = { param($a) [void]$a.Presentations.Add() } },
    @{ ProgId = 'Excel.Application'; Image = 'EXCEL'; Open = { param($a) [void]$a.Workbooks.Add() } },
    @{ ProgId = 'Access.Application'; Image = 'MSACCESS'; Open = { param($a) $a.NewCurrentDatabase((Join-Path $env:RUNNER_TEMP 'warmup.accdb')) } }
)
foreach ($round in 1..2) {
    foreach ($app in $apps) {
        $o = New-Object -ComObject $app.ProgId
        try { $o.Visible = $true } catch { Write-Host "$($app.ProgId): Visible failed: $($_.Exception.Message)" }
        try { & $app.Open $o } catch { Write-Host "$($app.ProgId): open failed: $($_.Exception.Message)" }
        $proc = Get-Process -Name $app.Image -ErrorAction SilentlyContinue | Select-Object -First 1
        $seen = @()
        if ($proc) {
            $until = (Get-Date).AddSeconds(20)
            while ((Get-Date) -lt $until) {
                $seen += [WarmDialogs]::CloseDialogs([uint32]$proc.Id)
                Start-Sleep -Milliseconds 250
            }
        }
        Write-Host "round $round $($app.ProgId): $(if ($seen) { ($seen | Select-Object -Unique) -join '; ' } else { 'no dialog' })"
        try { if ($app.Image -eq 'EXCEL') { $o.DisplayAlerts = $false }; if ($app.Image -eq 'MSACCESS') { $o.CloseCurrentDatabase() }; $o.Quit() } catch { }
        [void][Runtime.InteropServices.Marshal]::ReleaseComObject($o)
        Start-Sleep -Seconds 2
        Get-Process -Name $app.Image -ErrorAction SilentlyContinue | Stop-Process -Force
    }
}
Remove-Item (Join-Path $env:RUNNER_TEMP 'warmup.accdb') -Force -ErrorAction SilentlyContinue
