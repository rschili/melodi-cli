# Targets
.PHONY: build test cover run ide publish link unlink remove check-updates clean-workspace

ide:
	code .

build:
	npm run build
	chmod +x dist/index.mjs

test:
	npx vitest run

cover:
	npx vitest run --coverage

run:
	npm run start

publish: build
	npm publish --access public

link:
	npm link

unlink:
	npm unlink @rschili/melodi-cli

remove:
	npm rm -g @rschili/melodi-cli

check-updates:
	ncu

clean-workspace:
	rm -f workspace/*-shm workspace/*-wal

