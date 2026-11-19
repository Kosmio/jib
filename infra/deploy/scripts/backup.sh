#!/bin/bash
set -euo pipefail

# =============================================================================
# Sauvegarde de la base et des téléversements (NF-59, NF-51)
# =============================================================================
# Usage: backup.sh <environment> [install-cron]
#
# Sans second argument : pg_dump compressé de la base et archive des téléversements,
# horodatés (UTC), dans un dossier du serveur hors des volumes Docker. Seuls les
# KEEP plus récents de chaque sorte sont gardés (14 par défaut).
# install-cron : installe, de façon idempotente, l'entrée de planification
# quotidienne de 3h00 pour cet environnement.
#
# Environments: local, dev, preprod, prod
#
# Variables de réglage (toutes facultatives) :
#   BACKUP_POSTGRES_CONTAINER  conteneur Postgres              (défaut jib-postgres)
#   BACKUP_DB_USER             utilisateur Postgres            (défaut strapi)
#   BACKUP_DB_NAME             base sauvegardée                (défaut strapi)
#   BACKUP_DIR                 dossier de sortie               (défaut ~/jib/backups/<environment>)
#   BACKUP_UPLOADS_DIR         dossier des téléversements      (défaut ~/jib/data/uploads)
#   BACKUP_KEEP                nombre de sauvegardes gardées   (défaut 14)
#   BACKUP_CRON_FILE           si posé, install-cron écrit dans ce fichier au lieu de la crontab de l'utilisateur (essais)
#
# Examples:
#   ./backup.sh prod
#   ./backup.sh prod install-cron
#   BACKUP_DB_NAME=strapi_c5_test BACKUP_DIR=/tmp/essai ./backup.sh local
# =============================================================================

SCRIPT_PATH="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/$(basename "${BASH_SOURCE[0]}")"

ENVIRONMENT=${1:-}
MODE=${2:-backup}

VALID_ENVIRONMENTS=("local" "dev" "preprod" "prod")
if [[ ! " ${VALID_ENVIRONMENTS[*]} " =~ " ${ENVIRONMENT} " ]]; then
  echo "Usage: backup.sh <${VALID_ENVIRONMENTS[*]// /|}> [install-cron]" >&2
  exit 1
fi
if [[ "$MODE" != "backup" && "$MODE" != "install-cron" ]]; then
  echo "Error: Unknown mode '$MODE' (expected: install-cron or nothing)" >&2
  exit 1
fi

POSTGRES_CONTAINER=${BACKUP_POSTGRES_CONTAINER:-jib-postgres}
DB_USER=${BACKUP_DB_USER:-strapi}
DB_NAME=${BACKUP_DB_NAME:-strapi}
BACKUP_DIR=${BACKUP_DIR:-$HOME/jib/backups/$ENVIRONMENT}
UPLOADS_DIR=${BACKUP_UPLOADS_DIR:-$HOME/jib/data/uploads}
KEEP=${BACKUP_KEEP:-14}

if [[ ! "$KEEP" =~ ^[1-9][0-9]*$ ]]; then
  echo "Error: BACKUP_KEEP must be a positive integer, got '$KEEP'" >&2
  exit 1
fi

CRON_MARKER="# jib-backup-$ENVIRONMENT"

install_cron() {
  local line current
  line="0 3 * * * /bin/bash $SCRIPT_PATH $ENVIRONMENT >> $BACKUP_DIR.log 2>&1 $CRON_MARKER"
  if [[ -n "${BACKUP_CRON_FILE:-}" ]]; then
    current=$(cat "$BACKUP_CRON_FILE" 2>/dev/null || true)
  else
    current=$(crontab -l 2>/dev/null || true)
  fi
  # Les lignes portant le repère sont remplacées, jamais dupliquées ; les autres sont conservées.
  current=$(grep -v -F "$CRON_MARKER" <<< "$current" || true)
  if [[ -n "${BACKUP_CRON_FILE:-}" ]]; then
    printf '%s\n%s\n' "$current" "$line" | sed '/^$/d' > "$BACKUP_CRON_FILE"
  else
    printf '%s\n%s\n' "$current" "$line" | sed '/^$/d' | crontab -
  fi
  echo "Cron entry installed for $ENVIRONMENT: $line"
}

# Supprime tout sauf les KEEP plus récents d'une sorte de fichier (l'horodatage trie dans l'ordre du temps).
prune() {
  local pattern=$1 old
  find "$BACKUP_DIR" -maxdepth 1 -type f -name "$pattern" | sort \
    | awk -v keep="$KEEP" '{ a[NR] = $0 } END { for (i = 1; i <= NR - keep; i++) print a[i] }' \
    | while IFS= read -r old; do
        echo "Removing old backup: $old"
        rm -f -- "$old"
      done
}

backup() {
  local stamp n base db_file uploads_file

  if [[ "$(docker inspect -f '{{.State.Running}}' "$POSTGRES_CONTAINER" 2>/dev/null || true)" != "true" ]]; then
    echo "Error: Postgres container '$POSTGRES_CONTAINER' is not running" >&2
    exit 1
  fi
  if [[ ! -d "$UPLOADS_DIR" ]]; then
    echo "Error: uploads folder not found: $UPLOADS_DIR" >&2
    exit 1
  fi

  umask 077
  mkdir -p "$BACKUP_DIR"

  # Horodatage UTC suivi d'un numéro : deux sauvegardes dans la même seconde restent distinctes et triées.
  stamp=$(date -u +%Y-%m-%dT%H-%M-%SZ)
  n=1
  while true; do
    base=$(printf 'jib-%s-%%s-%s-%02d' "$ENVIRONMENT" "$stamp" "$n")
    db_file="$BACKUP_DIR/$(printf "$base" db).sql.gz"
    uploads_file="$BACKUP_DIR/$(printf "$base" uploads).tar.gz"
    [[ ! -e "$db_file" && ! -e "$uploads_file" ]] && break
    n=$((n + 1))
  done

  # Écriture dans un fichier temporaire, renommé seulement une fois complet : un échec ne laisse aucune archive à demi écrite.
  tmp_db="$db_file.tmp.$$"
  tmp_uploads="$uploads_file.tmp.$$"
  trap 'rm -f -- "$tmp_db" "$tmp_uploads"' EXIT

  echo "Dumping database '$DB_NAME' from $POSTGRES_CONTAINER..."
  docker exec "$POSTGRES_CONTAINER" pg_dump -U "$DB_USER" -d "$DB_NAME" --no-owner --no-privileges | gzip > "$tmp_db"
  gzip -t "$tmp_db"
  mv -- "$tmp_db" "$db_file"

  echo "Archiving uploads from $UPLOADS_DIR..."
  if ! tar -C "$UPLOADS_DIR" -czf "$tmp_uploads" . 2>/dev/null; then
    # Les fichiers téléversés appartiennent à l'utilisateur du conteneur Strapi : repli par Docker si l'hôte ne peut pas les lire.
    echo "Host tar failed, retrying through Docker..."
    docker run --rm -v "$UPLOADS_DIR:/u:ro" alpine:3.20 tar -C /u -czf - . > "$tmp_uploads"
  fi
  gzip -t "$tmp_uploads"
  mv -- "$tmp_uploads" "$uploads_file"

  prune "jib-$ENVIRONMENT-db-*.sql.gz"
  prune "jib-$ENVIRONMENT-uploads-*.tar.gz"

  echo "Backup done:"
  ls -lh "$db_file" "$uploads_file"
}

case "$MODE" in
  install-cron) install_cron ;;
  backup) backup ;;
esac
