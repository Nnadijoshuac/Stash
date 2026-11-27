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
  [Parameter(Mandatory)][ValidateSet('open','focus','resize','shot','click','type','key','scroll','info')][string]$Action,
  [string]$Title,
  [string]$Url,
  [string]$Out,
  [int]$X,
  [int]$Y,
  [string]$Text,
  [string]$Keys,
  [int]$Delta,
  [int]$Width,
  [int]$Height,
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
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr l);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, System.Text.StringBuilder s, int n);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  /** First visible Brave window whose centre lies inside the given screen rectangle. */
  public static IntPtr FindBraveOn(int x, int y, int w, int hgt) {
    IntPtr found = IntPtr.Zero;
    EnumWindows((h, l) => {
      if (!IsWindowVisible(h)) return true;
      var sb = new System.Text.StringBuilder(512); GetWindowText(h, sb, 512);
      if (!sb.ToString().EndsWith(" - Brave")) return true;
      RECT r; GetWindowRect(h, out r);
      int cx = (r.L + r.R) / 2, cy = (r.T + r.B) / 2;
      if (cx >= x && cx < x + w && cy >= y && cy < y + hgt) { found = h; return false; }
      return true;
    }, IntPtr.Zero);
    return found;
  }
  /** First visible top-level window whose title contains `part`. */
  public static IntPtr FindByTitle(string part, string suffix) {
    IntPtr found = IntPtr.Zero;
    EnumWindows((h, l) => {
      if (!IsWindowVisible(h)) return true;
      var sb = new System.Text.StringBuilder(512); GetWindowText(h, sb, 512);
      string title = sb.ToString();
      if (title.Contains(part) && title.EndsWith(suffix)) { found = h; return false; }
      return true;
    }, IntPtr.Zero);
    return found;
  }
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
    # Opens the URL in a new Brave window, then moves ONLY a window whose title
    # contains -Title (default 'Stash'). It never touches any other window, so
    # the owner's YouTube or anything else in Brave stays where it is
    # (ISSUES #11).
    if (-not $Title) { $Title = 'Stash' }
    # Prefer a new TAB in a Brave window already on this screen (owner's
    # request, 27 Nov). Only a window on the chosen screen is used, so a tab
    # never lands in the owner's window on the other screen. A new window is
    # opened only when this screen has no Brave window at all.
    $existing = [GuiNative]::FindBraveOn($b.X, $b.Y, $b.Width, $b.Height)
    if ($existing -ne [IntPtr]::Zero) {
      [GuiNative]::keybd_event(0x12, 0, 0, [UIntPtr]::Zero); [GuiNative]::keybd_event(0x12, 0, 2, [UIntPtr]::Zero)
      [void][GuiNative]::SetForegroundWindow($existing)
      Start-Sleep -Milliseconds 300
      [System.Windows.Forms.SendKeys]::SendWait('^t')
      Start-Sleep -Milliseconds 300
      $typed = [regex]::Replace($Url, '[+^%~(){}\[\]]', { param($m) '{' + $m.Value + '}' })
      [System.Windows.Forms.SendKeys]::SendWait($typed + '{ENTER}')
    } else {
      Start-Process 'C:\Program Files\BraveSoftware\Brave-Browser\Application\brave.exe' -ArgumentList '--new-window', $Url
    }
    $h = [IntPtr]::Zero
    for ($i = 0; $i -lt 40 -and $h -eq [IntPtr]::Zero; $i++) {
      Start-Sleep -Milliseconds 250
      $h = [GuiNative]::FindByTitle($Title, ' - Brave')
    }
    if ($h -eq [IntPtr]::Zero) { throw "Opened $Url but found no window titled '$Title - Brave'. Nothing was moved." }
    [GuiNative]::keybd_event(0x12, 0, 0, [UIntPtr]::Zero); [GuiNative]::keybd_event(0x12, 0, 2, [UIntPtr]::Zero)
    [void][GuiNative]::ShowWindow($h, 9)
    [void][GuiNative]::MoveWindow($h, $b.X, $b.Y, $b.Width, $b.Height, $true)
    [void][GuiNative]::ShowWindow($h, 3)
    [void][GuiNative]::SetForegroundWindow($h)
    "opened $Url in the '$Title' window on $($screen.DeviceName)"
  }

  'focus' {
    # Brings the window whose title contains -Title to the front on the chosen
    # screen. Keys then go to the app, not to whatever was in front.
    $h = [GuiNative]::FindByTitle($Title, ' - Brave')
    if ($h -eq [IntPtr]::Zero) { throw "No Brave window titled '$Title - Brave'." }
    [GuiNative]::keybd_event(0x12, 0, 0, [UIntPtr]::Zero); [GuiNative]::keybd_event(0x12, 0, 2, [UIntPtr]::Zero)
    [void][GuiNative]::ShowWindow($h, 9)
    [void][GuiNative]::MoveWindow($h, $b.X, $b.Y, $b.Width, $b.Height, $true)
    [void][GuiNative]::ShowWindow($h, 3)
    [void][GuiNative]::SetForegroundWindow($h)
    "focused '$Title' on $($screen.DeviceName)"
  }

  'resize' {
    # Shrinks the window titled -Title to -Width x -Height at the screen's
    # top-left, to see phone and tablet layouts. Browsers have a minimum
    # window width (about 500px), so true phone widths need a headless
    # screenshot instead.
    $h = [GuiNative]::FindByTitle($Title, ' - Brave')
    if ($h -eq [IntPtr]::Zero) { throw "No Brave window titled like '$Title'." }
    [void][GuiNative]::ShowWindow($h, 9)
    [void][GuiNative]::MoveWindow($h, $b.X, $b.Y, $Width, $Height, $true)
    [void][GuiNative]::SetForegroundWindow($h)
    "resized '$Title' to ${Width}x${Height}"
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
