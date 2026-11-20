#!/usr/bin/env bash
# Kurulum: şemayı derler, eklentiyi ve di-config aracını bağlar.
# Tekrar çalıştırmak güvenlidir.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
UUID="dynamic-island@10sinan.github.io"
EXT_SRC="$HERE/$UUID"
EXT_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/gnome-shell/extensions"
BIN_DIR="$HOME/.local/bin"

echo "• Şema derleniyor"
glib-compile-schemas --strict "$EXT_SRC/schemas"

echo "• Eklenti bağlanıyor: $EXT_DIR/$UUID"
mkdir -p "$EXT_DIR"
if [ -L "$EXT_DIR/$UUID" ]; then
    ln -sfn "$EXT_SRC" "$EXT_DIR/$UUID"
elif [ -e "$EXT_DIR/$UUID" ]; then
    echo "  ! $EXT_DIR/$UUID bir symlink değil; dokunulmadı." >&2
else
    ln -s "$EXT_SRC" "$EXT_DIR/$UUID"
fi

echo "• di-config bağlanıyor: $BIN_DIR/di-config"
mkdir -p "$BIN_DIR"
chmod +x "$HERE/tools/di-config"
ln -sfn "$HERE/tools/di-config" "$BIN_DIR/di-config"
chmod +x "$HERE/tools/di-claude-hook"
ln -sfn "$HERE/tools/di-claude-hook" "$BIN_DIR/di-claude-hook"
case ":$PATH:" in
    *":$BIN_DIR:"*) ;;
    *) echo "  ! $BIN_DIR PATH'te değil. ~/.bashrc'ye ekle: export PATH=\"\$HOME/.local/bin:\$PATH\"" ;;
esac

cat <<EOF

Bitti.
  1) Kod değiştiği için BİR KEZ oturumu kapatıp tekrar aç (Wayland'da shell yeniden başlatılamaz).
  2) Etkinleştir:   gnome-extensions enable $UUID
  3) Özelleştir:    di-config        (değişiklikler anında uygulanır, tekrar giriş gerekmez)
  Loglar:           journalctl -b -o cat /usr/bin/gnome-shell | grep -E "dynamic-island|JS ERROR"
EOF
