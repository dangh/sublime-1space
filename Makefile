all: install build

install: ;@echo "Installing ${PROJECT}....."; \
	git submodule update --init --recursive; \
	npm install --prefix ./build;

build: build-icons build-textures

build-icons: ;@echo "Building file icons....."; \
	pushd build; \
	node build-icons.js; \
	popd;

build-textures: ;@echo "Building textures....."; \
	pushd build; \
	node build-textures.js; \
	popd;
