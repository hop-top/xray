# shellcheck shell=sh
#
# graph-trust.sh: helpers shared by save-graph.sh (writer) and
# xray-impact-context (reader). Sourced, not run. POSIX sh.
#
# Trust model: graph-derived text (file paths, symbol names, kinds) goes
# into the model's context, so a graph is only used if this user's
# save-graph.sh wrote it. A cloned repo can ship (or plant) a crafted
# .xray/graph.json; it is never read. Concretely:
#
#   - the graph, and its directory (default .xray/), are not symlinks;
#   - the graph's physical path is inside the git work-tree root;
#   - the graph is not tracked by git, and its directory (unless it is
#     the work-tree root) holds no tracked file;
#   - its sha256 equals the sidecar save-graph.sh wrote after the save:
#       ${XDG_STATE_HOME:-$HOME/.local/state}/xray/hooks/<sha256 of the
#       graph's physical absolute path>     (dir mode 700, file 600)
#
# sha256 comes from `sha256sum` or `shasum -a 256`. With neither, no
# sidecar is written or matched, so the hooks stay silent.
#
# Functions print their result on stdout and return non-zero to refuse.

# sha256 of stdin, as 64 lowercase hex chars.
xray_sha256() {
  if command -v sha256sum >/dev/null 2>&1; then
    _xt_h=$(sha256sum) || return 1
  elif command -v shasum >/dev/null 2>&1; then
    _xt_h=$(shasum -a 256) || return 1
  else
    return 1
  fi
  _xt_h=${_xt_h%% *}
  [ "${#_xt_h}" -eq 64 ] || return 1
  case $_xt_h in *[!0-9a-f]*) return 1 ;; esac
  printf '%s\n' "$_xt_h"
}

# Physical path of the current git work-tree root.
xray_work_root() {
  _xt_r=$(git rev-parse --show-toplevel 2>/dev/null) || return 1
  [ -n "$_xt_r" ] || return 1
  (cd -P -- "$_xt_r" 2>/dev/null && pwd -P)
}

# xray_graph_abs <graph>: physical absolute path of <graph>; refuses when
# <graph> or its directory is a symlink. The directory must exist.
xray_graph_abs() {
  [ -L "$1" ] && return 1
  _xt_b=$(basename -- "$1")
  case $_xt_b in .|..|/) return 1 ;; esac
  _xt_d=$(dirname -- "$1")
  [ -L "$_xt_d" ] && return 1
  _xt_d=$(cd -P -- "$_xt_d" 2>/dev/null && pwd -P) || return 1
  printf '%s/%s\n' "${_xt_d%/}" "$_xt_b"
}

# xray_inside <physical path> <physical root>: path strictly under root.
xray_inside() {
  case $1 in "${2%/}"/?*) return 0 ;; esac
  return 1
}

# xray_sidecar <physical graph path>: the sidecar file for it.
xray_sidecar() {
  _xt_s=${XDG_STATE_HOME-}
  case $_xt_s in
    /*) ;;
    *) # unset, empty or relative (the XDG spec says ignore relative)
      [ -n "${HOME-}" ] || return 1
      _xt_s=$HOME/.local/state ;;
  esac
  _xt_k=$(printf '%s' "$1" | xray_sha256) || return 1
  printf '%s/xray/hooks/%s\n' "${_xt_s%/}" "$_xt_k"
}

# xray_record <physical graph path> <sha256>: write the sidecar.
xray_record() {
  _xt_f=$(xray_sidecar "$1") || return 1
  _xt_dir=${_xt_f%/*}
  (umask 077 && mkdir -p -- "$_xt_dir") || return 1
  chmod 700 "${_xt_dir%/*}" "$_xt_dir" 2>/dev/null || return 1
  [ -L "$_xt_f" ] && return 1
  (umask 077 && printf '%s\n' "$2" >"$_xt_f") || return 1
  chmod 600 "$_xt_f"
}
