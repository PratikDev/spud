IMAGE_NAME := spud
CONTAINER_NAME := spud
ENV_FILE := .env
PORT := 3000

.PHONY: build run logs stop start rm

build:
	docker build -t $(IMAGE_NAME) .

run:
	docker run --env-file $(ENV_FILE) -p $(PORT):3000 -v spud-data:/data --name $(CONTAINER_NAME) -d $(IMAGE_NAME)

logs:
	docker logs -f $(CONTAINER_NAME)

stop:
	docker stop $(CONTAINER_NAME)

start:
	docker start $(CONTAINER_NAME)

rm:
	docker rm -f $(CONTAINER_NAME)
