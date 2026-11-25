<#
  Drives the real desktop to test Stash's UI the way a person would:
  open the app in Brave on the extended screen, take screenshots, click,
  type, press keys and scroll.

  Coordinates for click and scroll are relative to the screen being tested
  (the PRIMARY screen by default; pass -Extended for the other one), in real
  pixels, matching the screenshots this script takes. The owner's extended
  screen is often in use, so it is never touched unless asked for. The process is made DPI-aware first, because the primary
  screen is scaled to 150% and unscaled coordinates land in the wrong place.

  Examples:
    .\tools\gui.ps1 open  -Url http://localhost:4321
    .\tools\gui.ps1 shot  -Out C:\tmp\stash.png
    .\tools\gui.ps1 click -X 400 -Y 300
    .\tools\gui.ps1 type  -Text "500"
    .\tools\gui.ps1 key   -Keys "{ENTER}"
    .\tools\gui.ps1 scroll -Delta -5
#>
param(
  [Parameter(Mandatory)][ValidateSet('open','focus','shot','click','type','key','scroll','info')][string]$Action,
  [string]$Title,
  [string]$Url,
  [string]$Out,
  [int]$X,
  [int]$Y,
  [string]$Text,
  [string]$Keys,
  [int]$Delta,
  [switch]$Extended
)

Add-Type -AssemblyName System.Windows.Forms, System.Drawing
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class GuiNative {
  [DllImport("user32.dll")] public static extern IntPtr SetProcessDpiAwarenessContext(IntPtr v);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint f, uint dx, uint dy, int data, UIntPtr extra);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int c);
  [DllImport("user32.dll")] public static extern bool MoveWindow(IntPtr h, int x, int y, int w, int hgt, bool r);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern void keybd_event(byte k, byte s, uint f, UIntPtr e);
}
'@
[void][GuiNative]::SetProcessDpiAwarenessContext([IntPtr]-4)

$screen = [System.Windows.Forms.Screen]::PrimaryScreen
if ($Extended) {
  $screen = [System.Windows.Forms.Screen]::AllScreens | Where-Object { -not $_.Primary } | Select-Object -First 1
  if (-not $screen) { throw 'No extended screen is connected.' }
}
$b = $screen.Bounds

switch ($Action) {
  'info' { "$($screen.DeviceName) $($b.X),$($b.Y) $($b.Width)x$($b.Height)" }

  'open' {
    Start-Process 'C:\Program Files\BraveSoftware\Brave-Browser\Application\brave.exe' -ArgumentList '--new-window', $Url
    $h = [IntPtr]::Zero
    for ($i = 0; $i -lt 40; $i++) {
      Start-Sleep -Milliseconds 250
      $fg = [GuiNative]::GetForegroundWindow(); $procId = 0
      [void][GuiNative]::GetWindowThreadProcessId($fg, [ref]$procId)
      if ((Get-Process -Id $procId -ErrorAction SilentlyContinue).ProcessName -eq 'brave') { $h = $fg; break }
    }
    if ($h -eq [IntPtr]::Zero) { throw 'Opened the URL but could not find the Brave window.' }
    [void][GuiNative]::ShowWindow($h, 9)
    [void][GuiNative]::MoveWindow($h, $b.X, $b.Y, $b.Width, $b.Height, $true)
    [void][GuiNative]::ShowWindow($h, 3)
    "opened $Url on $($screen.DeviceName)"
  }

  'focus' {
    # Bring the browser window whose title contains -Title to the front, on the
    # chosen screen, maximised. Safer than clicking: keys then go to the app,
    # not to whatever happened to be in front (ISSUES #11).
    $p = Get-Process brave, chrome -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowTitle -like "*$Title*" } | Select-Object -First 1
    if (-not $p) { throw "No Brave or Chrome window titled like '$Title'." }
    $h = $p.MainWindowHandle
    [GuiNative]::keybd_event(0x12, 0, 0, [UIntPtr]::Zero); [GuiNative]::keybd_event(0x12, 0, 2, [UIntPtr]::Zero)
    [void][GuiNative]::ShowWindow($h, 9)
    [void][GuiNative]::MoveWindow($h, $b.X, $b.Y, $b.Width, $b.Height, $true)
    [void][GuiNative]::ShowWindow($h, 3)
    [void][GuiNative]::SetForegroundWindow($h)
    "focused '$($p.MainWindowTitle)' on $($screen.DeviceName)"
  }

  'shot' {
    if (-not $Out) { throw 'shot needs -Out <file.png>' }
    $bmp = New-Object System.Drawing.Bitmap $b.Width, $b.Height
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.CopyFromScreen($b.X, $b.Y, 0, 0, $bmp.Size)
    $bmp.Save($Out, [System.Drawing.Imaging.ImageFormat]::Png)
    $g.Dispose(); $bmp.Dispose()
    "saved $Out ($($b.Width)x$($b.Height))"
  }

  'click' {
    [void][GuiNative]::SetCursorPos($b.X + $X, $b.Y + $Y)
    Start-Sleep -Milliseconds 80
    [GuiNative]::mouse_event(0x0002, 0, 0, 0, [UIntPtr]::Zero)  # left down
    [GuiNative]::mouse_event(0x0004, 0, 0, 0, [UIntPtr]::Zero)  # left up
    "clicked $X,$Y"
  }

  'type' {
    # SendKeys treats + ^ % ~ ( ) { } [ ] as commands; escape them so text types literally.
    $escaped = [regex]::Replace($Text, '[+^%~(){}\[\]]', { param($m) '{' + $m.Value + '}' })
    [System.Windows.Forms.SendKeys]::SendWait($escaped)
    "typed $($Text.Length) characters"
  }

  'key' {
    [System.Windows.Forms.SendKeys]::SendWait($Keys)
    "sent $Keys"
  }

  'scroll' {
    [void][GuiNative]::SetCursorPos($b.X + [int]($b.Width / 2), $b.Y + [int]($b.Height / 2))
    [GuiNative]::mouse_event(0x0800, 0, 0, 120 * $Delta, [UIntPtr]::Zero)
    "scrolled $Delta"
  }
}
