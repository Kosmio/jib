VERSION = $(shell cat VERSION)

.PHONY: lint build test stage promote infra-up infra-down infra-logs infra-ps infra-pull

## =============================================================================
## INFRASTRUCTURE SHORTCUTS
## =============================================================================

## Start local infrastructure (Postgres, Strapi, Web)
infra-up:
	@./infra/deploy/scripts/deploy.sh local up

## Stop local infrastructure
infra-down:
	@./infra/deploy/scripts/deploy.sh local down

## View infrastructure logs
infra-logs:
	@./infra/deploy/scripts/deploy.sh local logs

## Check infrastructure status
infra-ps:
	@./infra/deploy/scripts/deploy.sh local ps

## Pull latest infrastructure images
infra-pull:
	@./infra/deploy/scripts/deploy.sh local pull

## Validate infrastructure configuration
infra-validate:
	@./infra/deploy/scripts/deploy.sh local validate

## Show merged infrastructure configuration
infra-config:
	@./infra/deploy/scripts/deploy.sh local config

## Kill ALL Docker containers and networks
infra-kill:
	@./infra/deploy/scripts/deploy.sh local kill

## =============================================================================
## BUILD TARGETS
## =============================================================================

## Run lint for all components
lint:
	@$(MAKE) -f infra/make/make_web.mk lint
	@$(MAKE) -f infra/make/make_strapi.mk lint

## Run build for all components
build:
	@$(MAKE) -f infra/make/make_web.mk build
	@$(MAKE) -f infra/make/make_strapi.mk build

## Run tests for all components
test:
	@$(MAKE) -f infra/make/make_web.mk test
	@$(MAKE) -f infra/make/make_strapi.mk test

## Publish (stage) all components
stage: publish

publish:
	@$(MAKE) -f infra/make/make_web.mk stage
	@$(MAKE) -f infra/make/make_strapi.mk stage

## Promote all components
promote:
	@$(MAKE) -f infra/make/make_web.mk promote
	@$(MAKE) -f infra/make/make_strapi.mk promote
