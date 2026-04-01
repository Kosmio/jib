VERSION = $(shell cat VERSION)

JIB_WEB_DOCKERFILE	:= infra/docker/website/Dockerfile
JIB_WEB_NAME		:= jib-web
JIB_WEB_IMG		:= ${JIB_WEB_NAME}:${VERSION}

.PHONY: lint build test stage promote

lint: docker-jib-web-lint

build: docker-jib-web-build

test:
	echo 'No Test'

stage: docker-jib-web-stage

promote:
	echo 'No Promote'

docker-jib-web-lint:
	@docker run --rm -i hadolint/hadolint hadolint - < ${JIB_WEB_DOCKERFILE}

docker-jib-web-build:
	@docker build --no-cache=true \
		-f ${JIB_WEB_DOCKERFILE} -t ${JIB_WEB_IMG} .

docker-jib-web-stage:
	@docker tag ${JIB_WEB_IMG} ${DOCKER_REGISTRY_REPOSITORY}${JIB_WEB_IMG}
	@docker push ${DOCKER_REGISTRY_REPOSITORY}${JIB_WEB_IMG}
