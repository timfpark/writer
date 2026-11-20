# Features install at image build time, before devcontainer.json settings
# apply, and the node feature installs yarn with npm. Configuring the registry
# proxies here, globally, makes those installs and every later npm, pip, and uv
# command use them. These are proxy URLs only; never add credentials or build
# arguments.

# Debian trixie with Python 3.14, Bash, and Git. The digest pins every tool
# the image provides, including the Python patch release. The tag names the
# Python line so Dependabot refreshes the digest and proposes Python upgrades;
# image-versioned tags such as 3.3.3-3.14-trixie make it misread the version.
FROM mcr.microsoft.com/devcontainers/python:3.14-trixie@sha256:2e0589f0725c951ac8ae0d7169784a9694f5818ec5264ed5231f23c6bf0ab7be

# npm's global config normally lives under each Node.js install prefix, which
# nvm creates later and per version, so point every version at /etc/npmrc.
ENV NPM_CONFIG_GLOBALCONFIG=/etc/npmrc

RUN printf '%s\n' 'registry=https://packagefeedproxy.microsoft.io/npm/' > /etc/npmrc \
 && printf '%s\n' '[global]' 'index-url = https://packagefeedproxy.microsoft.io/pypi/simple/' > /etc/pip.conf \
 && mkdir -p /etc/uv \
 && printf '%s\n' '[[index]]' 'url = "https://packagefeedproxy.microsoft.io/pypi/simple/"' 'default = true' > /etc/uv/uv.toml
