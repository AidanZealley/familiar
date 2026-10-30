$ErrorActionPreference = 'Stop'

# Keep this bootstrap independent of the CLI: Node, release package, then setup.
$version = if ($env:FAMILIAR_VERSION) { $env:FAMILIAR_VERSION } else { 'latest' }
if ($version -eq 'latest') {
    $release = 'https://github.com/AidanZealley/familiar/releases/latest/download'
} elseif ($version -cmatch '^v[0-9][a-zA-Z0-9.+-]*$') {
    $release = "https://github.com/AidanZealley/familiar/releases/download/$version"
} else {
    throw 'FAMILIAR_VERSION must be latest or a v-prefixed release tag.'
}
$architecture = [Runtime.InteropServices.RuntimeInformation]::OSArchitecture.ToString().ToLowerInvariant()
$arch = switch ($architecture) { 'x64' { 'x64' } 'arm64' { 'arm64' } default { throw 'Supported architectures: x64 and arm64.' } }
$temporary = Join-Path ([IO.Path]::GetTempPath()) ([Guid]::NewGuid().ToString())
New-Item -ItemType Directory -Path $temporary | Out-Null
try {
    Write-Host "Downloading Familiar ($version)..."
    $package = Join-Path $temporary 'familiar.tgz'
    Invoke-WebRequest "$release/familiar.tgz" -OutFile $package -UseBasicParsing
    $prefix = Join-Path $env:APPDATA 'npm'
    # npm's shim prefers an adjacent node.exe, even with an older system Node on PATH.
    $nodeDir = $prefix
    if (Test-Path (Join-Path $nodeDir 'node.exe')) { $env:PATH = "$nodeDir;$env:PATH" }
    $node = Get-Command node -ErrorAction SilentlyContinue
    $current = if ($node) { [version]((& node --version).TrimStart('v')) } else { [version]'0.0.0' }
    if ($LASTEXITCODE -and $node) { throw 'Could not run the existing Node installation.' }
    if ($current -lt [version]'24.19.0') {
        $archive = "node-v24.19.0-win-$arch.zip"
        $base = 'https://nodejs.org/dist/v24.19.0'
        $zip = Join-Path $temporary $archive
        Invoke-WebRequest "$base/$archive" -OutFile $zip -UseBasicParsing
        $checksums = Join-Path $temporary 'SHASUMS256.txt'
        Invoke-WebRequest "$base/SHASUMS256.txt" -OutFile $checksums -UseBasicParsing
        $expected = (Get-Content $checksums | Where-Object { ($_ -split '\s+')[1] -eq $archive }) -split '\s+'
        if (!$expected[0] -or (Get-FileHash $zip -Algorithm SHA256).Hash -ne $expected[0]) { throw 'Node checksum verification failed.' }
        Expand-Archive -LiteralPath $zip -DestinationPath $temporary
        New-Item -ItemType Directory -Force -Path $nodeDir | Out-Null
        Copy-Item -Path (Join-Path $temporary "node-v24.19.0-win-$arch\*") -Destination $nodeDir -Recurse -Force
        $env:PATH = "$nodeDir;$env:PATH"
    }
    $nodeBin = Split-Path (Get-Command node).Source
    $env:PATH = "$nodeBin;$prefix;$env:PATH"
    & npm.cmd install --global --prefix $prefix $package
    if ($LASTEXITCODE -ne 0) { throw 'Familiar package installation failed.' }
    $userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
    $entries = @($userPath -split ';' | Where-Object { $_ })
    foreach ($directory in @($nodeBin, $prefix)) {
        if ($entries -notcontains $directory) { $entries += $directory }
    }
    [Environment]::SetEnvironmentVariable('Path', ($entries -join ';'), 'User')
    Write-Host 'Installed Familiar. PATH is saved for new terminals.'
    if ($env:FAMILIAR_NO_SETUP -eq '1') {
        Write-Host 'Run familiar to start guided setup.'
    } else {
        & (Join-Path $prefix 'familiar.cmd')
        if ($LASTEXITCODE -ne 0) { throw 'Setup did not finish. Run familiar to resume.' }
    }
} finally {
    Remove-Item -LiteralPath $temporary -Recurse -Force
}
