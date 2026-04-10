VERSION = $(shell cat VERSION)

SKELETON_MCP_DOCKERFILE	:= infra/docker/mcp/Dockerfile
SKELETON_MCP_NAME		:= skeleton-mcp
SKELETON_MCP_IMG		:= ${SKELETON_MCP_NAME}:${VERSION}

.PHONY: lint build test stage promote

lint: docker-skeleton-mcp-lint

build: docker-skeleton-mcp-build

test:
	echo 'No Test'

stage: docker-skeleton-mcp-stage

promote:
	echo 'No Promote'

docker-skeleton-mcp-lint:
	@docker run --rm -i hadolint/hadolint hadolint - < ${SKELETON_MCP_DOCKERFILE}

docker-skeleton-mcp-build:
	@docker build --no-cache=true \
		-f ${SKELETON_MCP_DOCKERFILE} -t ${SKELETON_MCP_IMG} .

docker-skeleton-mcp-stage:
	@docker tag ${SKELETON_MCP_IMG} ${CI_REGISTRY_URL}/${SKELETON_MCP_IMG}
	@docker push ${CI_REGISTRY_URL}/${SKELETON_MCP_IMG}
