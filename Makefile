.PHONY: help install up down logs reset dev mcp test typecheck eval clean

help:  ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-15s\033[0m %s\n", $$1, $$2}'

install:  ## Install dependencies
	bun install
	cd memgc-service && uv sync

up:  ## Start Docker infra (Redis + Kafka + memgc-service)
	docker compose up -d
	@echo "Waiting for services to be healthy..."
	@sleep 5
	@docker compose ps

down:  ## Stop Docker infra
	docker compose down

reset:  ## Wipe volumes and restart infra (destroys data)
	docker compose down -v
	docker compose up -d

logs:  ## Tail Docker logs
	docker compose logs -f

dev:  ## Run Bun app in watch mode (port 8002)
	bun run dev

mcp:  ## Run all 4 MCP servers concurrently
	bun run mcp:all

test:  ## Run tests
	bun test

typecheck:  ## Type check
	bun run typecheck

eval:  ## Run Promptfoo evals
	bun run eval

clean:  ## Remove node_modules and bun.lock
	rm -rf node_modules bun.lock
	rm -rf memgc-service/.venv

health:  ## Probe all services
	@echo "→ Bun app (8002)"
	@curl -fsS http://localhost:8002/health 2>&1 || echo "  ✗ down"
	@echo ""
	@echo "→ memgc-service (8003)"
	@curl -fsS http://localhost:8003/health 2>&1 || echo "  ✗ down"
	@echo ""
	@echo "→ Redis (6379)"
	@docker exec feedme-redis redis-cli ping 2>&1 || echo "  ✗ down"
	@echo ""
	@echo "→ Kafka (9094)"
	@docker exec feedme-kafka kafka-topics.sh --bootstrap-server localhost:9092 --list 2>&1 | head -5 || echo "  ✗ down"
