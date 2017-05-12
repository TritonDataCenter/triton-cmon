#
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at http://mozilla.org/MPL/2.0/.
#

#
# Copyright 2017 Joyent, Inc.
#

#
# Makefile for CMON
#

CLEAN_FILES += ./node_modules
DOC_FILES	 = index.md
JS_FILES	:= $(shell find lib test bin -name '*.js')
JSSTYLE_FILES	= $(JS_FILES)
JSSTYLE_FLAGS	= -o indent=4,doxygen,unparenthesized-return=0
ESLINT		= ./node_modules/.bin/eslint
ESLINT_FILES	= $(JS_FILES)

NODE_PREBUILT_VERSION=v4.8.1
NODE_PREBUILT_TAG=zone64
NODE_PREBUILT_IMAGE=18b094b0-eb01-11e5-80c1-175dac7ddf02

# Included definitions
include ./tools/mk/Makefile.defs
include ./tools/mk/Makefile.node_prebuilt.defs
include ./tools/mk/Makefile.smf.defs

RELEASE_TARBALL	:= $(NAME)-pkg-$(STAMP).tar.bz2
RELSTAGEDIR     := /tmp/$(STAMP)
TAPE			= $(TOP)/node_modules/tape/bin/tape

#
# Repo-specific targets
#
.PHONY: all
all: | $(REPO_DEPS) $(NPM_EXEC)
	$(NPM) install

$(TAPE): | $(NPM_EXEC)
	$(NPM) install

.PHONY: test
test: all | $(TAPE) $(NODE_EXEC)
	TAPE=1 $(NODE) $(TAPE) test/*.test.js

.PHONY: release
release: all docs $(SMF_MANIFESTS) $(NODE_EXEC)
	@echo "Building $(RELEASE_TARBALL)"
	@mkdir -p $(RELSTAGEDIR)/root/opt/triton/$(NAME)
	cp -r   $(TOP)/bin \
		$(TOP)/lib \
		$(TOP)/node_modules \
		$(TOP)/package.json \
		$(TOP)/sapi_manifests \
		$(TOP)/test \
		$(TOP)/smf \
		$(RELSTAGEDIR)/root/opt/triton/cmon/
	@mkdir -p $(RELSTAGEDIR)/root/opt/triton/cmon/build
	cp -r   $(TOP)/build/node \
		$(RELSTAGEDIR)/root/opt/triton/cmon/build/
	@mkdir -p $(RELSTAGEDIR)/root/opt/smartdc/boot
	cp -R $(TOP)/node_modules/sdc-scripts/* $(RELSTAGEDIR)/root/opt/smartdc/boot/
	cp -R $(TOP)/boot/* $(RELSTAGEDIR)/root/opt/smartdc/boot/
	(cd $(RELSTAGEDIR) && $(TAR) -jcf $(TOP)/$(RELEASE_TARBALL) root)
	@rm -rf $(RELSTAGEDIR)

.PHONY: publish
publish: release
	@if [[ -z "$(BITS_DIR)" ]]; then \
		echo "error: 'BITS_DIR' must be set for 'publish' target"; \
		exit 1; \
	fi
	mkdir -p $(BITS_DIR)/$(NAME)
	cp $(TOP)/$(RELEASE_TARBALL) $(BITS_DIR)/$(NAME)/$(RELEASE_TARBALL)

$(ESLINT):
		npm install eslint@2.13.1 eslint-plugin-joyent@1.0.1

.PHONY: check-eslint
check-eslint:: $(ESLINT)
		$(ESLINT) $(ESLINT_FILES)

check:: check-eslint

include ./tools/mk/Makefile.deps
include ./tools/mk/Makefile.node_prebuilt.targ
include ./tools/mk/Makefile.smf.targ
include ./tools/mk/Makefile.targ
