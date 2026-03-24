VERSION = $(shell cat VERSION)

JIB_STRAPI_DOCKERFILE	:= infra/docker/strapi/Dockerfile
JIB_STRAPI_NAME		:= jib-strapi
JIB_STRAPI_IMG			:= ${JIB_STRAPI_NAME}:${VERSION}

.PHONY: lint build test stage promote

lint: docker-jib-strapi-lint

build: docker-jib-strapi-build

test:
	echo 'No Test'

stage: docker-jib-strapi-stage

promote:
	echo 'No Promote'

docker-jib-strapi-lint:
	@docker run --rm -i hadolint/hadolint hadolint - < ${JIB_STRAPI_DOCKERFILE}

docker-jib-strapi-build:
	@docker build --no-cache=true \
		-f ${JIB_STRAPI_DOCKERFILE} -t ${JIB_STRAPI_IMG} .

docker-jib-strapi-stage:
	@docker tag ${JIB_STRAPI_IMG} ${CI_REGISTRY_URL}/${JIB_STRAPI_IMG}
	@docker push ${CI_REGISTRY_URL}/${JIB_STRAPI_IMG}
