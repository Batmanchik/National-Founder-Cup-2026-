// Определяет активное окно (приложение + заголовок + URL вкладки, где можно) без нативных модулей.
// Windows: один фоновый PowerShell-процесс с WinAPI GetForegroundWindow.
// macOS: osascript (System Events + URL активной вкладки Chrome/Safari).
// Linux: xdotool.
const { execFile, spawn } = require('child_process');
const fs = require('fs');

function run(cmd, args, timeout = 1500) {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout, windowsHide: true }, (err, stdout) => resolve(err ? null : String(stdout).trim()));
  });
}

const WIN_PS = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public class NazarWin {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint p);
}
"@
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
while ($true) {
  $h = [NazarWin]::GetForegroundWindow()
  $sb = New-Object System.Text.StringBuilder 512
  [void][NazarWin]::GetWindowText($h, $sb, 512)
  [uint32]$p = 0
  [void][NazarWin]::GetWindowThreadProcessId($h, [ref]$p)
  $name = ''
  try { $name = (Get-Process -Id $p -ErrorAction Stop).ProcessName } catch {}
  $o = @{ app = $name; title = $sb.ToString() } | ConvertTo-Json -Compress
  [Console]::Out.WriteLine($o)
  [Console]::Out.Flush()
  Start-Sleep -Milliseconds 1500
}
`;

const MAC_FRONT = `
tell application "System Events"
  set frontApp to first application process whose frontmost is true
  set appName to name of frontApp
  set winTitle to ""
  try
    set winTitle to name of front window of frontApp
  end try
end tell
return appName & "|||" & winTitle
`;

const MAC_URL = {
  'Google Chrome': 'tell application "Google Chrome" to return URL of active tab of front window',
  'Brave Browser': 'tell application "Brave Browser" to return URL of active tab of front window',
  'Microsoft Edge': 'tell application "Microsoft Edge" to return URL of active tab of front window',
  Safari: 'tell application "Safari" to return URL of front document',
};

class ActivityWatcher {
  constructor() {
    this.current = { app: '', title: '', url: '' };
    this.supported = true;
    this.override = null; // демо-режим: подменённое окно до override.until
    this._timer = null;
    this._busy = false;
    this._proc = null;
  }

  get window() {
    if (this.override && Date.now() < this.override.until) return this.override.win;
    return this.current;
  }

  simulate(win, seconds = 40) {
    this.override = { win, until: Date.now() + seconds * 1000 };
  }

  start() {
    if (process.platform === 'win32') return this._startWindows();
    this._timer = setInterval(() => this._poll(), 1500);
    this._poll();
  }

  stop() {
    clearInterval(this._timer);
    if (this._proc) this._proc.kill();
  }

  _startWindows() {
    const encoded = Buffer.from(WIN_PS, 'utf16le').toString('base64');
    this._proc = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded], {
      windowsHide: true,
    });
    let buf = '';
    this._proc.stdout.on('data', (chunk) => {
      buf += chunk.toString('utf8');
      const lines = buf.split(/\r?\n/);
      buf = lines.pop();
      for (const line of lines) {
        try {
          const o = JSON.parse(line);
          this.current = { app: o.app || '', title: o.title || '', url: '' };
        } catch {
          /* неполная строка */
        }
      }
    });
    this._proc.on('error', () => (this.supported = false));
    this._proc.on('exit', () => (this._proc = null));
  }

  async _poll() {
    if (this._busy) return;
    this._busy = true;
    try {
      if (process.platform === 'darwin') await this._pollMac();
      else await this._pollLinux();
    } finally {
      this._busy = false;
    }
  }

  async _pollMac() {
    const out = await run('osascript', ['-e', MAC_FRONT]);
    if (out === null) {
      this.supported = false;
      return;
    }
    const [app, title] = out.split('|||');
    let url = '';
    if (MAC_URL[app]) url = (await run('osascript', ['-e', MAC_URL[app]])) || '';
    this.current = { app: app || '', title: title || '', url };
  }

  async _pollLinux() {
    const title = await run('xdotool', ['getactivewindow', 'getwindowname']);
    if (title === null) {
      this.supported = false;
      return;
    }
    let app = '';
    const pid = await run('xdotool', ['getactivewindow', 'getwindowpid']);
    if (pid) {
      try {
        app = fs.readFileSync(`/proc/${pid}/comm`, 'utf8').trim();
      } catch {
        /* нет доступа к процессу */
      }
    }
    this.current = { app, title, url: '' };
  }
}

module.exports = { ActivityWatcher };
