#!/usr/bin/env bash
# Kurulum: şemayı derler, eklentiyi ve di-config / di-claude-hook araçlarını bağlar.
# Tekrar çalıştırmak güvenlidir. Eklenti dizini başka bir şeyse hiçbir şeyi ezmez ve hata verir.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
UUID="dynamic-island@10sinan.github.io"
EXT_SRC="$HERE/$UUID"
EXT_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/gnome-shell/extensions"
BIN_DIR="$HOME/.local/bin"

die() { echo "Hata: $*" >&2; exit 1; }

command -v glib-compile-schemas >/dev/null 2>&1 ||
    die "glib-compile-schemas bulunamadı (Fedora: sudo dnf install glib2-devel · Debian/Ubuntu: sudo apt install libglib2.0-bin)."
[ -d "$EXT_SRC" ] || die "eklenti klasörü yok: $EXT_SRC"

echo "• Şema derleniyor"
glib-compile-schemas --strict "$EXT_SRC/schemas"

echo "• Eklenti bağlanıyor: $EXT_DIR/$UUID"
mkdir -p "$EXT_DIR"
if [ -L "$EXT_DIR/$UUID" ]; then
    ln -sfn "$EXT_SRC" "$EXT_DIR/$UUID"
elif [ -e "$EXT_DIR/$UUID" ]; then
    die "$EXT_DIR/$UUID bir symlink değil (elle kopyalanmış olabilir); dokunulmadı. Önce kaldır ya da taşı, sonra tekrar çalıştır."
else
    ln -s "$EXT_SRC" "$EXT_DIR/$UUID"
fi

echo "• Araçlar bağlanıyor: $BIN_DIR/di-config, $BIN_DIR/di-claude-hook"
mkdir -p "$BIN_DIR"
for tool in di-config di-claude-hook; do
    chmod +x "$HERE/tools/$tool"
    ln -sfn "$HERE/tools/$tool" "$BIN_DIR/$tool"
done
case ":$PATH:" in
    *":$BIN_DIR:"*) ;;
    *) echo "  ! $BIN_DIR PATH'te değil. Kabuk ayar dosyana ekle (örn. ~/.bashrc): export PATH=\"\$HOME/.local/bin:\$PATH\"" >&2 ;;
esac

cat <<EOF

Bitti.
  1) Kod değiştiği için BİR KEZ oturumu kapatıp tekrar aç (Wayland'da shell yeniden başlatılamaz).
  2) Etkinleştir:   gnome-extensions enable $UUID
  3) Özelleştir:    di-config        (ayar değişiklikleri anında uygulanır, tekrar giriş gerekmez)
  Loglar:           journalctl -b -o cat /usr/bin/gnome-shell | grep -E "dynamic-island|JS ERROR"
EOF
