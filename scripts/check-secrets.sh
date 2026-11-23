#!/bin/bash
# Fails if any file that would be committed contains something that looks like a secret.
#
#   scripts/check-secrets.sh            scan every tracked + untracked (non-ignored) file
#   scripts/check-secrets.sh --staged   scan only staged files (used by the pre-commit hook)
#
# Extra private patterns (your own domain, IDs, names...) can go in
# .git/secret-patterns, one regex per line. Files inside .git are never pushed.

cd "$(git rev-parse --show-toplevel)" || exit 1

PATTERNS_FILE=$(mktemp)
trap 'rm -f "$PATTERNS_FILE"' EXIT

cat > "$PATTERNS_FILE" <<'EOF'
discord(app)?\.com/api/webhooks/[0-9]+/
hooks\.slack\.com/services/
GOCSPX-[A-Za-z0-9_-]{10,}
[0-9]+-[a-z0-9]{20,}\.apps\.googleusercontent\.com
(secret|ntn)_[A-Za-z0-9]{30,}
gh[pousr]_[A-Za-z0-9]{30,}
sk-[A-Za-z0-9_-]{20,}
AIza[0-9A-Za-z_-]{30,}
xox[abpr]-[A-Za-z0-9-]{10,}
Bearer [A-Za-z0-9._-]{20,}
-----BEGIN [A-Z ]*PRIVATE KEY-----
[0-9a-f]{32}
[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}
EOF

PRIVATE_PATTERNS="$(git rev-parse --git-dir)/secret-patterns"
if [ -f "$PRIVATE_PATTERNS" ]; then
  grep -v '^\s*$' "$PRIVATE_PATTERNS" >> "$PATTERNS_FILE"
fi

# Obviously fake addresses used in tests and docs are allowed.
ALLOW_FILE=$(mktemp)
trap 'rm -f "$PATTERNS_FILE" "$ALLOW_FILE"' EXIT
cat > "$ALLOW_FILE" <<'EOF'
@([a-z0-9-]+\.)*example(\.(com|org|net))?$
@[a-z0-9.-]+\.test$
@acme\.com$
@([a-z0-9-]+\.)*greenhouse-mail\.io$
@linkedin\.com$
EOF

if [ "$1" = "--staged" ]; then
  FILES=$(git diff --cached --name-only --diff-filter=ACM)
else
  FILES=$( (git ls-files; git ls-files --others --exclude-standard) | sort -u)
fi

FOUND=0
for f in $FILES; do
  [ -f "$f" ] || continue
  case "$f" in
    scripts/check-secrets.sh|LICENSE) continue ;;
  esac
  HITS=$(grep -nEIo -f "$PATTERNS_FILE" "$f" 2>/dev/null | grep -vE -f "$ALLOW_FILE")
  if [ -n "$HITS" ]; then
    echo "Possible secret in $f:"
    echo "$HITS" | sed 's/^/    line /'
    FOUND=1
  fi
done

if [ "$FOUND" -ne 0 ]; then
  echo ""
  echo "Blocked: remove the values above (use placeholders like YOUR_DISCORD_WEBHOOK_URL)."
  exit 1
fi
echo "Secret scan: clean"
