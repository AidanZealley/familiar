import { execFileSync } from 'node:child_process'

export const powershellString = (value: string) =>
  `'${value.replaceAll("'", "''")}'`

/** EncodedCommand avoids Windows argv quoting for scripts and Unicode paths. */
export function powershell(script: string, follow = false) {
  const command = `$ErrorActionPreference = 'Stop'; [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false); ${script}`
  return execFileSync(
    'powershell.exe',
    [
      '-NoLogo',
      '-NoProfile',
      '-NonInteractive',
      '-EncodedCommand',
      Buffer.from(command, 'utf16le').toString('base64'),
    ],
    {
      // PowerShell 7 module paths can break Windows PowerShell's built-in modules.
      env: Object.fromEntries(
        Object.entries(process.env).filter(
          ([key]) => key.toLowerCase() !== 'psmodulepath',
        ),
      ),
      encoding: 'utf8',
      windowsHide: true,
      timeout: follow ? undefined : 15000,
      stdio: follow ? 'inherit' : ['ignore', 'pipe', 'pipe'],
    },
  )
}

/** chmod cannot restrict Windows ACLs, including on an existing data directory. */
export function protectWindowsDirectory(directory: string) {
  powershell(`
$directory = ${powershellString(directory)};
# Build only the DACL: copying a full descriptor through Set-Acl can require
# SeSecurityPrivilege to write audit information, even for the directory owner.
$acl = [Security.AccessControl.DirectorySecurity]::new();
$acl.SetAccessRuleProtection($true, $false);
$sid = [Security.Principal.WindowsIdentity]::GetCurrent().User;
$rule = [Security.AccessControl.FileSystemAccessRule]::new($sid, 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow');
$acl.AddAccessRule($rule);
[IO.Directory]::SetAccessControl($directory, $acl)
`)
}
