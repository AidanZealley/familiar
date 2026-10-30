import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from 'vitest'
import {
  powershell,
  powershellString,
  protectWindowsDirectory,
} from './windows-powershell.ts'

test.skipIf(process.platform !== 'win32')(
  'directory protection works without elevation and replaces existing permissions',
  () => {
    const parent = mkdtempSync(join(tmpdir(), 'familiar-permissions-'))
    const directory = join(parent, "Owner's files & 家")
    mkdirSync(directory)
    try {
      // An explicit extra grant must be removed, as well as inherited grants.
      powershell(`
$directory = ${powershellString(directory)};
$acl = Get-Acl -LiteralPath $directory;
$everyone = [Security.Principal.SecurityIdentifier]::new('S-1-1-0');
$rule = [Security.AccessControl.FileSystemAccessRule]::new($everyone, 'Read', 'Allow');
$acl.AddAccessRule($rule);
[IO.Directory]::SetAccessControl($directory, $acl)
`)
      protectWindowsDirectory(directory)
      protectWindowsDirectory(directory)
      const result = powershell(`
$acl = Get-Acl -LiteralPath ${powershellString(directory)};
$rules = @($acl.Access);
$sid = [Security.Principal.WindowsIdentity]::GetCurrent().User;
if (!$acl.AreAccessRulesProtected -or $rules.Count -ne 1) { throw 'Unexpected access rules' }
$rule = $rules[0];
if ($rule.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value -ne $sid.Value) { throw 'Unexpected trustee' }
if ($rule.IsInherited -or $rule.AccessControlType -ne 'Allow' -or $rule.FileSystemRights -ne 'FullControl') { throw 'Unexpected rights' }
if ($rule.InheritanceFlags -ne 'ContainerInherit,ObjectInherit' -or $rule.PropagationFlags -ne 'None') { throw 'Unexpected inheritance' }
Write-Output 'protected'
`)
      expect(result.trim()).toBe('protected')
      writeFileSync(join(directory, 'still-writable.txt'), 'ok')
    } finally {
      rmSync(parent, { recursive: true, force: true })
    }
  },
  30000,
)
