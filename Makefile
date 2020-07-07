all: install build

install: ;@echo "Installing ${PROJECT}....."; \
	git submodule update --init --recursive; \
	npm install --prefix ./scripts;

build: build-icons build-textures

build-icons: ;@echo "Building file icons....."; \
	pushd scripts; \
	node build-icons.js; \
	popd;

build-textures: ;@echo "Building textures....."; \
	pushd scripts; \
	node build-textures.js; \
	popd;
