// A persistent, local JSON-lines worker avoids starting PowerShell for every encoder tick.
export const windowsHelper = String.raw`
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class DeckNative {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern void keybd_event(byte key, byte scan, uint flags, UIntPtr extra);
  [DllImport("user32.dll")] public static extern void mouse_event(uint flags, uint x, uint y, int data, UIntPtr extra);
}
'@
function Key([int]$code, [bool]$up) {
  $flags = 0
  if ($code -ge 33 -and $code -le 46 -or $code -ge 166) { $flags = 1 }
  if ($up) { $flags = $flags -bor 2 }
  [DeckNative]::keybd_event([byte]$code, 0, $flags, [UIntPtr]::Zero)
}
[Console]::WriteLine('{"ready":true}')
while ($null -ne ($line = [Console]::ReadLine())) {
  $req = $null
  try {
    $req = $line | ConvertFrom-Json
    $result = ''
    switch ($req.method) {
      'foreground' {
        [uint32]$processId = 0
        [void][DeckNative]::GetWindowThreadProcessId([DeckNative]::GetForegroundWindow(), [ref]$processId)
        if ($processId -gt 0) { $result = (Get-Process -Id $processId).ProcessName + '.exe' }
      }
      'keys' {
        for ($i = 0; $i -lt $req.count; $i++) {
          try { foreach ($code in $req.keys) { Key $code $false } }
          finally { for ($j = $req.keys.Count - 1; $j -ge 0; $j--) { Key $req.keys[$j] $true } }
        }
      }
      'scroll' {
        if ($req.x -ne 0) { [DeckNative]::mouse_event(0x1000, 0, 0, [int]$req.x * 120, [UIntPtr]::Zero) }
        if ($req.y -ne 0) { [DeckNative]::mouse_event(0x0800, 0, 0, [int]$req.y * 120, [UIntPtr]::Zero) }
      }
      default { throw 'Unknown operation' }
    }
    [Console]::WriteLine((@{ id = $req.id; result = $result } | ConvertTo-Json -Compress))
  } catch {
    [Console]::WriteLine((@{ id = $req.id; error = $_.Exception.Message } | ConvertTo-Json -Compress))
  }
}
`;
