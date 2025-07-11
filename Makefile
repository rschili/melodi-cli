# Targets
.PHONY: build test run ide

ide:
	code .

build:
	npm run build
	chmod +x dist/index.mjs

test:
	npm run test

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

