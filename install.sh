#!/bin/sh
set -eu

# Keep this bootstrap independent of the CLI: Node, release package, then setup.
main() {
  version=${FAMILIAR_VERSION:-latest}
  case "$version" in
    latest) release=https://github.com/AidanZealley/familiar/releases/latest/download ;;
    v[0-9]*)
      case "$version" in *[!a-zA-Z0-9.+-]*) echo 'Invalid FAMILIAR_VERSION tag.' >&2; exit 1 ;; esac
      release="https://github.com/AidanZealley/familiar/releases/download/$version"
      ;;
    *) echo 'FAMILIAR_VERSION must be latest or a v-prefixed release tag.' >&2; exit 1 ;;
  esac
  case "$(uname -s)" in Linux) os=linux ;; Darwin) os=darwin ;; *) echo 'Use install.ps1 on Windows.' >&2; exit 1 ;; esac
  case "$(uname -m)" in x86_64|amd64) arch=x64 ;; arm64|aarch64) arch=arm64 ;; *) echo 'Supported architectures: x64 and arm64.' >&2; exit 1 ;; esac
  command -v curl >/dev/null || { echo 'Install curl, then run this script again.' >&2; exit 1; }
  temporary=$(mktemp -d)
  trap 'rm -rf "$temporary"' EXIT
  trap 'exit 1' HUP INT TERM
  echo "Downloading Familiar ($version)..."
  curl -fSL "$release/familiar.tgz" -o "$temporary/familiar.tgz"

  node_dir="$HOME/.local/share/familiar-node"
  prefix="$HOME/.local"
  # Reuse a runtime installed by an earlier run even before the profile is loaded.
  if [ -x "$node_dir/bin/node" ]; then PATH="$node_dir/bin:$PATH"; fi
  if ! command -v node >/dev/null || ! node -e 'const [major, minor] = process.versions.node.split(".").map(Number); process.exit(major > 24 || major === 24 && minor >= 19 ? 0 : 1)' ; then
    archive="node-v24.19.0-$os-$arch.tar.gz"
    base=https://nodejs.org/dist/v24.19.0
    curl -fSL "$base/$archive" -o "$temporary/$archive"
    curl -fsSL "$base/SHASUMS256.txt" -o "$temporary/SHASUMS256.txt"
    expected=$(awk -v file="$archive" '$2 == file { print $1 }' "$temporary/SHASUMS256.txt")
    if command -v sha256sum >/dev/null; then
      actual=$(sha256sum "$temporary/$archive" | awk '{ print $1 }')
    else
      actual=$(shasum -a 256 "$temporary/$archive" | awk '{ print $1 }')
    fi
    [ -n "$expected" ] && [ "$actual" = "$expected" ] || { echo 'Node checksum verification failed.' >&2; exit 1; }
    mkdir -p "$node_dir"
    tar -xzf "$temporary/$archive" -C "$node_dir" --strip-components=1
    PATH="$node_dir/bin:$PATH"
  fi
  node_bin=$(dirname "$(command -v node)")
  PATH="$node_bin:$prefix/bin:$PATH"
  export PATH
  command -v npm >/dev/null || { echo 'This Node installation has no npm. Install Node with npm and try again.' >&2; exit 1; }
  npm install --global --prefix "$prefix" "$temporary/familiar.tgz"

  case "${SHELL:-}" in
    */zsh) profile="$HOME/.zshrc" ;;
    */bash) profile="$HOME/.bashrc" ;;
    *) profile="$HOME/.profile" ;;
  esac
  # A literal HOME keeps profile entries portable and avoids quoting home paths.
  line='export PATH="$HOME/.local/share/familiar-node/bin:$HOME/.local/bin:$PATH"'
  if ! grep -Fqx "$line" "$profile" 2>/dev/null; then
    printf '\n%s\n' "$line" >> "$profile"
  fi
  echo "Installed Familiar. New terminals load PATH from $profile."
  if [ "${FAMILIAR_NO_SETUP:-0}" = 1 ]; then
    echo 'Run familiar to start guided setup.'
  elif [ -r /dev/tty ] && ( : </dev/tty ) 2>/dev/null; then
    "$prefix/bin/familiar" </dev/tty
  else
    echo 'No interactive terminal. Open a terminal and run familiar to finish setup.'
  fi
}

# Parse the complete download before running setup, which needs terminal stdin.
main
