#!/bin/sh
#
# extract-symbol.sh: the identifier an agent is searching for, or nothing.
#
#   extract-symbol.sh pattern '<search pattern>'   # Grep / grep_search tool
#   extract-symbol.sh command '<shell command>'    # Bash / run_shell_command
#
# Prints the symbol plus a newline when it is a plain identifier
# (^[A-Za-z_][A-Za-z0-9_]{2,}$); prints nothing for regexes, paths, short
# words and anything else. For a command: the first non-flag argument of
# the first grep/egrep/fgrep/rg in a pipeline or && / ; chain (or the
# value of -e/--regexp). A command that starts with `xray` is skipped.
# No jq needed; always exits 0.

kind=${1-}
value=${2-}

is_ident() {
  case $1 in
    [A-Za-z_][A-Za-z0-9_][A-Za-z0-9_]*) ;;
    *) return 1 ;;
  esac
  case $1 in
    *[!A-Za-z0-9_]*) return 1 ;;
  esac
  return 0
}

emit() {
  is_ident "$1" && printf '%s\n' "$1"
  exit 0
}

# Strip one pair of matching surrounding quotes.
unquote() {
  case $1 in
    \"*\") v=${1#\"}; printf '%s' "${v%\"}" ;;
    \'*\') v=${1#\'}; printf '%s' "${v%\'}" ;;
    *) printf '%s' "$1" ;;
  esac
}

# Pattern from the words of one grep/rg invocation (tool name first).
from_words() {
  shift # the tool name
  skip=0
  ended=0
  for w in "$@"; do
    if [ "$skip" = 1 ]; then
      skip=0
      continue
    fi
    if [ "$ended" = 0 ]; then
      case $w in
        --) ended=1; continue ;;
        # Flags whose value is the next word.
        -A|-B|-C|-m|-f|-d|-D|-g|-t|-T|-M|-j|\
        --glob|--type|--type-not|--max-count|--file|--context|\
        --after-context|--before-context|--include|--exclude|\
        --exclude-dir|--max-columns|--threads) skip=1; continue ;;
        -*) continue ;;
      esac
    fi
    emit "$(unquote "$w")"
  done
  exit 0
}

case $kind in
  pattern)
    emit "$value"
    ;;
  command)
    # Leading whitespace, then `xray …` (incl. `xray … | grep …`): skip.
    trimmed=${value#"${value%%[![:space:]]*}"}
    case $trimmed in
      xray|xray[[:space:]]*) exit 0 ;;
    esac
    # Split on | ; & into one segment per line, and walk each.
    set -f
    # shellcheck disable=SC2020  # one newline per separator char, on purpose
    printf '%s\n' "$value" | tr '|;&' '\n\n\n' | while IFS= read -r seg; do
      # shellcheck disable=SC2086  # word splitting is the point
      set -- $seg
      [ $# -gt 0 ] || continue
      case $1 in
        grep|egrep|fgrep|rg)
          # -e/--regexp: the next word is the pattern.
          prev=
          for w in "$@"; do
            case $prev in
              -e|--regexp) emit "$(unquote "$w")" ;;
            esac
            prev=$w
          done
          from_words "$@"
          ;;
      esac
    done
    ;;
esac
exit 0
