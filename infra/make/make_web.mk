VERSION = $(shell cat VERSION)

SKELETON_WEB_DOCKERFILE	:= infra/docker/website/Dockerfile
SKELETON_WEB_NAME		:= skeleton-web
SKELETON_WEB_IMG		:= ${SKELETON_WEB_NAME}:${VERSION}

.PHONY: lint build test stage promote

lint: docker-skeleton-web-lint

build: docker-skeleton-web-build

test:
	echo 'No Test'

stage: docker-skeleton-web-stage

promote:
	echo 'No Promote'

docker-skeleton-web-lint:
	@docker run --rm -i hadolint/hadolint hadolint - < ${SKELETON_WEB_DOCKERFILE}

docker-skeleton-web-build:
	@docker build --no-cache=true \
		-f ${SKELETON_WEB_DOCKERFILE} -t ${SKELETON_WEB_IMG} .

docker-skeleton-web-stage:
	@docker tag ${SKELETON_WEB_IMG} ${CI_REGISTRY_URL}/${SKELETON_WEB_IMG}
	@docker push ${CI_REGISTRY_URL}/${SKELETON_WEB_IMG}
