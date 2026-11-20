# Features install at image build time, before devcontainer.json settings
# apply, and the node feature installs yarn with npm. Configuring the registry
# proxies here, globally, makes those installs and every later npm, pip, and uv
# command use them. These are proxy URLs only; never add credentials or build
# arguments.

# Debian trixie with Python 3.14, Bash, and Git. The digest pins every tool
# the image provides, including the Python patch release.
FROM mcr.microsoft.com/devcontainers/python:3.15-trixie@sha256:0ae003ea761a00b8f8809cfdd08a04edfb1c7f17e76c413b27882ce5939a65f4

# npm's global config normally lives under each Node.js install prefix, which
# nvm creates later and per version, so point every version at /etc/npmrc.
ENV NPM_CONFIG_GLOBALCONFIG=/etc/npmrc

RUN printf '%s\n' 'registry=https://packagefeedproxy.microsoft.io/npm/' > /etc/npmrc \
 && printf '%s\n' '[global]' 'index-url = https://packagefeedproxy.microsoft.io/pypi/simple/' > /etc/pip.conf \
 && mkdir -p /etc/uv \
 && printf '%s\n' '[[index]]' 'url = "https://packagefeedproxy.microsoft.io/pypi/simple/"' 'default = true' > /etc/uv/uv.toml
