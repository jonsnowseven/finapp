# FinApp — local dev helpers. Run `make` (or `make dev`) to start the web app.
WEB := finapp-web

.DEFAULT_GOAL := dev
.PHONY: dev run install build start typecheck clean help

## dev: install deps if needed, then start the Next.js dev server (http://localhost:3000)
dev run: install
	cd $(WEB) && npm run dev

## install: install web dependencies (only when node_modules is missing)
install:
	@if [ ! -d "$(WEB)/node_modules" ]; then \
		echo "Installing dependencies…"; cd $(WEB) && npm install; \
	fi

## build: production build
build: install
	cd $(WEB) && npm run build

## start: run the production build (must `make build` first)
start:
	cd $(WEB) && npm run start

## typecheck: TypeScript check without emitting
typecheck: install
	cd $(WEB) && npx tsc --noEmit

## clean: remove build output and installed deps
clean:
	rm -rf $(WEB)/.next $(WEB)/node_modules $(WEB)/tsconfig.tsbuildinfo

## help: list targets
help:
	@grep -E '^## ' $(MAKEFILE_LIST) | sed 's/## //'
