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
		--build-arg ADMIN_URL=${ADMIN_URL} \
		--build-arg STRAPI_ADMIN_BACKEND_URL=${STRAPI_ADMIN_BACKEND_URL} \
		-f ${JIB_STRAPI_DOCKERFILE} -t ${JIB_STRAPI_IMG} .

docker-jib-strapi-stage:
	@docker tag ${JIB_STRAPI_IMG} ${DOCKER_REGISTRY_REPOSITORY}${JIB_STRAPI_IMG}
	@docker push ${DOCKER_REGISTRY_REPOSITORY}${JIB_STRAPI_IMG}
