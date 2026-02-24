SHELL := /bin/bash

.PHONY: install validate-config collect dev build test e2e verify

install:
	pnpm i

validate-config:
	pnpm -w validate:config

collect:
	pnpm -w collect

dev:
	pnpm -w dev

build:
	pnpm -w build

test:
	pnpm -w test

e2e:
	pnpm -w e2e

verify:
	pnpm -w verify
