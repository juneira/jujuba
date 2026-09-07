.PHONY: build start test lint fix_lint

BINARY := jujuba

build:
	go build -o $(BINARY) .

start:
	go run .

test:
	go test ./...

lint:
	go vet ./...
	@diff="$$(gofmt -l .)"; \
	if [ -n "$$diff" ]; then \
		echo "unformatted files:"; \
		echo "$$diff"; \
		exit 1; \
	fi

fix_lint:
	gofmt -w .
