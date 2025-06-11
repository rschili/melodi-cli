# Targets
.PHONY: build test run ide

ide:
	code .

build:
	npm run build
	chmod +x dist/index.js

test:
	npm run test

run:
	npm run start

publish:
	npm publish --access public

link:
	npm link

unlink:
	npm unlink melodi-cli

remove:
	npm rm -g melodi-cli


