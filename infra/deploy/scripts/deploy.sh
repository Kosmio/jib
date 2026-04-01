#!/bin/bash
set -euo pipefail

# =============================================================================
# Unified Deployment Script for Journées Innovation Bois
# =============================================================================
# Usage: ./deploy.sh <environment> <action> [options]
#
# Environments: local, dev, prod
# Actions: up, down, logs, ps, pull, restart, config, validate, kill
#
# Options:
#   --skip-services <svc1,svc2>  Skip specific services (comma-separated, for up/pull)
#
# Examples:
#   ./deploy.sh local up           # Start local development
#   ./deploy.sh dev up             # Deploy to dev
#   ./deploy.sh prod pull          # Pull latest images for prod
#   ./deploy.sh local logs         # View logs
#   ./deploy.sh local kill         # Force kill and remove all containers/networks
# =============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BASE_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

ENVIRONMENT=${1:-local}
ACTION=${2:-up}
shift 2 || true

# Parse options
SKIP_SERVICES=""
EXTRA_ARGS=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    --skip-services)
      SKIP_SERVICES="$2"
      shift 2
      ;;
    *)
      EXTRA_ARGS+=("$1")
      shift
      ;;
  esac
done

# Validate environment
VALID_ENVIRONMENTS=("local" "dev" "prod")
if [[ ! " ${VALID_ENVIRONMENTS[@]} " =~ " ${ENVIRONMENT} " ]]; then
  echo "Error: Invalid environment '$ENVIRONMENT'"
  echo "Valid environments: ${VALID_ENVIRONMENTS[*]}"
  exit 1
fi

# Set paths
COMPOSE_BASE="$BASE_DIR/base/docker-compose.base.yml"
COMPOSE_OVERLAY="$BASE_DIR/overlays/$ENVIRONMENT/docker-compose.override.yml"

# Allow custom env file via DOCKER_COMPOSE_ENV_FILE environment variable
if [[ -n "${DOCKER_COMPOSE_ENV_FILE:-}" ]]; then
  ENV_FILE="$DOCKER_COMPOSE_ENV_FILE"
else
  ENV_FILE="$BASE_DIR/overlays/$ENVIRONMENT/.env.$ENVIRONMENT"
fi

# Validate files exist
if [[ ! -f "$COMPOSE_BASE" ]]; then
  echo "Error: Base compose file not found: $COMPOSE_BASE"
  exit 1
fi

if [[ ! -f "$COMPOSE_OVERLAY" ]]; then
  echo "Error: Overlay compose file not found: $COMPOSE_OVERLAY"
  exit 1
fi

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Error: Environment file not found: $ENV_FILE"
  exit 1
fi

# Create network if it doesn't exist
create_network() {
  local network_name
  network_name=$(grep "^DOCKER_NETWORK=" "$ENV_FILE" | cut -d'=' -f2 | tr -d '"' | tr -d "'")

  if [[ -z "$network_name" ]]; then
    echo "Warning: DOCKER_NETWORK not set in $ENV_FILE, using default"
    network_name="jib-network"
  fi

  if ! docker network inspect "$network_name" &>/dev/null; then
    echo "Creating Docker network: $network_name"
    docker network create "$network_name"
  fi
}

# Build compose command
compose_cmd() {
  docker compose \
    -f "$COMPOSE_BASE" \
    -f "$COMPOSE_OVERLAY" \
    --env-file "$ENV_FILE" \
    --project-name "jib-$ENVIRONMENT" \
    "$@"
}

# Resolve services, excluding any specified in --skip-services
resolve_services() {
  if [[ -z "$SKIP_SERVICES" ]]; then
    return
  fi
  local all_services
  all_services=$(compose_cmd config --services)
  IFS=',' read -ra skip_array <<< "$SKIP_SERVICES"
  local services=()
  while IFS= read -r svc; do
    local skip=false
    for s in "${skip_array[@]}"; do
      if [[ "$svc" == "$s" ]]; then
        skip=true
        break
      fi
    done
    if ! $skip; then
      services+=("$svc")
    fi
  done <<< "$all_services"
  echo "${services[@]}"
}

# Show current configuration
show_info() {
  echo "============================================="
  echo "Journées Innovation Bois Deployment"
  echo "============================================="
  echo "Environment: $ENVIRONMENT"
  echo "Action: $ACTION"
  echo "Base: $COMPOSE_BASE"
  echo "Overlay: $COMPOSE_OVERLAY"
  echo "Env file: $ENV_FILE"
  echo "============================================="
}

# Main actions
case "$ACTION" in
  up)
    show_info
    create_network
    SERVICES=$(resolve_services)
    if [[ -n "$SKIP_SERVICES" ]]; then
      echo "Starting services for $ENVIRONMENT (skipping: $SKIP_SERVICES)..."
    else
      echo "Starting services for $ENVIRONMENT..."
    fi
    NO_DEPS=""
    if [[ -n "$SKIP_SERVICES" ]]; then
      NO_DEPS="--no-deps"
    fi
    compose_cmd up -d --force-recreate $NO_DEPS $SERVICES ${EXTRA_ARGS[@]+"${EXTRA_ARGS[@]}"}
    echo "Services started. Use './deploy.sh $ENVIRONMENT ps' to see status."
    ;;

  down)
    show_info
    echo "Stopping services for $ENVIRONMENT..."
    compose_cmd down ${EXTRA_ARGS[@]+"${EXTRA_ARGS[@]}"}
    echo "Services stopped."
    ;;

  logs)
    compose_cmd logs -f ${EXTRA_ARGS[@]+"${EXTRA_ARGS[@]}"}
    ;;

  ps)
    compose_cmd ps ${EXTRA_ARGS[@]+"${EXTRA_ARGS[@]}"}
    ;;

  pull)
    show_info
    SERVICES=$(resolve_services)
    if [[ -n "$SKIP_SERVICES" ]]; then
      echo "Pulling latest images for $ENVIRONMENT (skipping: $SKIP_SERVICES)..."
    else
      echo "Pulling latest images for $ENVIRONMENT..."
    fi
    compose_cmd pull $SERVICES ${EXTRA_ARGS[@]+"${EXTRA_ARGS[@]}"}
    echo "Images pulled."
    ;;

  restart)
    show_info
    echo "Restarting services for $ENVIRONMENT..."
    compose_cmd restart ${EXTRA_ARGS[@]+"${EXTRA_ARGS[@]}"}
    echo "Services restarted."
    ;;

  config)
    echo "Showing merged configuration for $ENVIRONMENT:"
    compose_cmd config ${EXTRA_ARGS[@]+"${EXTRA_ARGS[@]}"}
    ;;

  validate)
    echo "Validating configuration for $ENVIRONMENT..."
    if compose_cmd config --quiet ${EXTRA_ARGS[@]+"${EXTRA_ARGS[@]}"}; then
      echo "Configuration is valid."
    else
      echo "Configuration has errors."
      exit 1
    fi
    ;;

  kill)
    show_info
    echo "WARNING: This will forcefully kill and remove all containers for $ENVIRONMENT"
    echo "Press Ctrl+C within 5 seconds to cancel..."
    sleep 5

    PROJECT_NAME="jib-$ENVIRONMENT"

    RUNNING_CONTAINERS=$(docker ps --filter "label=com.docker.compose.project=$PROJECT_NAME" -q)
    if [[ -n "$RUNNING_CONTAINERS" ]]; then
      CONTAINER_NAMES=$(docker ps --filter "label=com.docker.compose.project=$PROJECT_NAME" --format '{{.Names}}' | tr '\n' ', ' | sed 's/,$//')
      echo "Killing running containers: $CONTAINER_NAMES"
      docker kill $RUNNING_CONTAINERS
    else
      echo "No running containers to kill for project: $PROJECT_NAME"
    fi

    ALL_CONTAINERS=$(docker ps -a --filter "label=com.docker.compose.project=$PROJECT_NAME" -q)
    if [[ -n "$ALL_CONTAINERS" ]]; then
      CONTAINER_NAMES=$(docker ps -a --filter "label=com.docker.compose.project=$PROJECT_NAME" --format '{{.Names}}' | tr '\n' ', ' | sed 's/,$//')
      echo "Removing containers: $CONTAINER_NAMES"
      docker rm -f $ALL_CONTAINERS
    else
      echo "No containers to remove for project: $PROJECT_NAME"
    fi

    PROJECT_NETWORKS=$(docker network ls --filter "label=com.docker.compose.project=$PROJECT_NAME" -q)
    if [[ -n "$PROJECT_NETWORKS" ]]; then
      NETWORK_NAMES=$(docker network ls --filter "label=com.docker.compose.project=$PROJECT_NAME" --format '{{.Name}}' | tr '\n' ', ' | sed 's/,$//')
      echo "Removing networks: $NETWORK_NAMES"
      docker network rm $PROJECT_NETWORKS 2>/dev/null || echo "Some networks may still be in use"
    else
      echo "No networks to remove for project: $PROJECT_NAME"
    fi

    if [[ "${EXTRA_ARGS[0]:-}" == "--volumes" ]]; then
      PROJECT_VOLUMES=$(docker volume ls --filter "label=com.docker.compose.project=$PROJECT_NAME" -q)
      if [[ -n "$PROJECT_VOLUMES" ]]; then
        VOLUME_NAMES=$(docker volume ls --filter "label=com.docker.compose.project=$PROJECT_NAME" --format '{{.Name}}' | tr '\n' ', ' | sed 's/,$//')
        echo "Removing volumes: $VOLUME_NAMES"
        docker volume rm $PROJECT_VOLUMES
      else
        echo "No volumes to remove for project: $PROJECT_NAME"
      fi
    fi

    echo "Kill complete for $ENVIRONMENT. All containers and networks removed."
    echo "Tip: Use './deploy.sh $ENVIRONMENT kill --volumes' to also remove volumes."
    ;;

  *)
    echo "Error: Unknown action '$ACTION'"
    echo "Valid actions: up, down, logs, ps, pull, restart, config, validate, kill"
    exit 1
    ;;
esac
