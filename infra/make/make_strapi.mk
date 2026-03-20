VERSION = $(shell cat VERSION)

SKELETON_STRAPI_DOCKERFILE	:= infra/docker/strapi/Dockerfile
SKELETON_STRAPI_NAME		:= skeleton-strapi
SKELETON_STRAPI_IMG			:= ${SKELETON_STRAPI_NAME}:${VERSION}

.PHONY: lint build test stage promote

lint: docker-skeleton-strapi-lint

build: docker-skeleton-strapi-build

test:
	echo 'No Test'

stage: docker-skeleton-strapi-stage

promote:
	echo 'No Promote'

docker-skeleton-strapi-lint:
	@docker run --rm -i hadolint/hadolint hadolint - < ${SKELETON_STRAPI_DOCKERFILE}

docker-skeleton-strapi-build:
	@docker build --no-cache=true \
		-f ${SKELETON_STRAPI_DOCKERFILE} -t ${SKELETON_STRAPI_IMG} .

docker-skeleton-strapi-stage:
	@docker tag ${SKELETON_STRAPI_IMG} ${CI_REGISTRY_URL}/${SKELETON_STRAPI_IMG}
	@docker push ${CI_REGISTRY_URL}/${SKELETON_STRAPI_IMG}
