#
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at http://mozilla.org/MPL/2.0/.
#

#
# Copyright 2022 Joyent, Inc.
#

#
# Makefile for CMON
#

ENGBLD_USE_BUILDIMAGE   = true
ENGBLD_REQUIRE          := $(shell git submodule update --init deps/eng)
include ./deps/eng/tools/mk/Makefile.defs
TOP ?= $(error Unable to access eng.git submodule Makefiles.)

# 'make check' vars
JS_FILES	:= ./bin/cmon $(shell find lib test -name '*.js')
JSSTYLE_FILES	= $(JS_FILES)
JSSTYLE_FLAGS	= -f tools/jsstyle.conf
ESLINT_FILES   = $(JS_FILES)
ESLINT		= ./node_modules/.bin/eslint
ESLINT_FILES	= $(JS_FILES)

SMF_MANIFESTS_IN = smf/manifests/cmon.xml.in

# sdcnode (aka prebuilt-node) vars
NODE_PREBUILT_VERSION=v6.17.1
NODE_PREBUILT_TAG=zone64
NODE_PREBUILT_IMAGE=a7199134-7e94-11ec-be67-db6f482136c2

BUILD_PLATFORM  = 20210826T002459Z

ifeq ($(shell uname -s),SunOS)
	include ./deps/eng/tools/mk/Makefile.node_prebuilt.defs
	include ./deps/eng/tools/mk/Makefile.agent_prebuilt.defs
else
	NPM=npm
	NODE=node
	NPM_EXEC=$(shell which npm)
	NODE_EXEC=$(shell which node)
endif
include ./deps/eng/tools/mk/Makefile.smf.defs

# other vars
NAME		:= cmon
RELEASE_TARBALL	:= $(NAME)-pkg-$(STAMP).tar.gz
RELSTAGEDIR	:= /tmp/$(NAME)-$(STAMP)
TAPE		= $(TOP)/node_modules/tape/bin/tape
CLEAN_FILES	+= ./node_modules

# our base image is triton-origin-x86_64-21.4.0
BASE_IMAGE_UUID = 502eeef2-8267-489f-b19c-a206906f57ef
BUILDIMAGE_NAME = $(NAME)
BUILDIMAGE_DESC	= Triton Container Monitor
AGENTS		= config registrar

#
# Repo-specific targets
#
.PHONY: all
all: | $(REPO_DEPS) $(NPM_EXEC)
	$(NPM) install --production

$(TAPE): | $(NPM_EXEC)
	$(NPM) install

.PHONY: test
test: all | $(TAPE) $(NODE_EXEC)
	$(NODE) $(TAPE) test/*.test.js

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
	(cd $(RELSTAGEDIR) && $(TAR) -I pigz -cf $(TOP)/$(RELEASE_TARBALL) root)
	@rm -rf $(RELSTAGEDIR)

.PHONY: publish
publish: release
	mkdir -p $(ENGBLD_BITS_DIR)/$(NAME)
	cp $(TOP)/$(RELEASE_TARBALL) $(ENGBLD_BITS_DIR)/$(NAME)/$(RELEASE_TARBALL)

include ./deps/eng/tools/mk/Makefile.deps
ifeq ($(shell uname -s),SunOS)
	include ./deps/eng/tools/mk/Makefile.node_prebuilt.targ
	include ./deps/eng/tools/mk/Makefile.agent_prebuilt.targ
endif
include ./deps/eng/tools/mk/Makefile.smf.targ
include ./deps/eng/tools/mk/Makefile.targ
