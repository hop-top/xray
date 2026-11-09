#!/bin/sh
#
# save-graph.sh: start saving the project's code graph in the background
# and print a one-line orientation for the agent.
#
#   save-graph.sh [<project dir>]     # default: current directory
#
# Runs `xray --quiet map --format json` detached (stdin/stdout/stderr on
# /dev/null, so the harness does not wait for it) into a mktemp file in
# the graph's directory, then renames it into place, so readers never
# see a half-written graph. One save at a time per target (mkdir lock).
# After the rename it records the graph's sha256 in a per-user sidecar,
# ${XDG_STATE_HOME:-$HOME/.local/state}/xray/hooks/<sha256 of the graph's
# absolute path> (dir 700, file 600); xray-impact-context only reads a
# graph whose sha256 matches. Without `sha256sum` or `shasum` no sidecar
# is written, so the impact hooks stay silent. See graph-trust.sh.
#
# Target: $XRAY_GRAPH, else <project dir>/.xray/graph.json. It must
# resolve inside the git work tree. Add `.xray/` to your .gitignore.
#
# Does nothing (prints nothing) outside a git work tree, so a session
# opened in $HOME does not map the whole home directory; when xray is
# not on PATH; or when the target is unsafe: the graph's directory
# (.xray), the graph, or its lock is a symlink, or the graph resolves
# outside the work-tree root. Always exits 0.
#
# Used by claude/session-start.sh, gemini/session-start.sh and
# nerv/xray-save-graph.sh.

here=$(cd "$(dirname "$0")" && pwd) || exit 0
# shellcheck source=hooks/harness/lib/graph-trust.sh
. "$here/graph-trust.sh" || exit 0

dir=${1:-.}
cd "$dir" 2>/dev/null || exit 0
command -v xray >/dev/null 2>&1 || exit 0
command -v git >/dev/null 2>&1 || exit 0
git rev-parse --is-inside-work-tree >/dev/null 2>&1 || exit 0
root=$(xray_work_root) || exit 0

graph=${XRAY_GRAPH:-.xray/graph.json}
case $graph in
  /*) ;;
  *) graph="$(pwd)/$graph" ;;
esac
out_dir=$(dirname -- "$graph")

# Before creating anything: the nearest existing ancestor must resolve
# inside the work tree (mkdir -p must not create directories through a
# link that leads elsewhere). Then: no symlinked graph dir or graph, and
# the graph's physical path is inside the work tree.
anc=$out_dir
while [ ! -e "$anc" ] && [ ! -L "$anc" ]; do
  anc=$(dirname -- "$anc")
done
anc=$(cd -P -- "$anc" 2>/dev/null && pwd -P) || exit 0
case $anc/ in
  "$root"/*) ;;
  *) exit 0 ;;
esac
mkdir -p -- "$out_dir" 2>/dev/null || exit 0

abs=$(xray_graph_abs "$graph") || exit 0
xray_inside "$abs" "$root" || exit 0

lock="$abs.lock"
[ -L "$lock" ] && exit 0
# A lock older than 10 minutes is a crashed save: take it over.
if [ -d "$lock" ] && [ -n "$(find "$lock" -maxdepth 0 -mmin +10 2>/dev/null)" ]; then
  rmdir "$lock" 2>/dev/null
fi

if mkdir "$lock" 2>/dev/null; then
  (
    tmp=
    trap 'rm -f "$tmp"; rmdir "$lock" 2>/dev/null' EXIT
    # mktemp: a new private file (O_EXCL) in the checked directory.
    tmp=$(mktemp "${abs%/*}/.graph.saving.XXXXXX") || exit 0
    xray --quiet map --format json -o "$tmp" || exit 0
    [ -L "$abs" ] && exit 0
    sha=$(xray_sha256 <"$tmp") || sha=
    mv -f "$tmp" "$abs" || exit 0
    [ -n "$sha" ] && xray_record "$abs" "$sha"
  ) </dev/null >/dev/null 2>&1 &
fi

limit=
if command -v timeout >/dev/null 2>&1; then
  limit="timeout 3"
elif command -v gtimeout >/dev/null 2>&1; then
  limit="gtimeout 3"
fi
# shellcheck disable=SC2086  # $limit: empty, or "timeout 3"
strategies=$($limit xray --quiet strategy detect 2>/dev/null | awk '{print $1}' | paste -sd, - | sed 's/,/, /g')

line="[xray] code graph saving in the background to $graph"
[ -n "$strategies" ] && line="$line; strategies: $strategies"
line="$line. Callers of a function: xray impact <symbol> --graph $graph --format brief"
printf '%s\n' "$line"
exit 0
