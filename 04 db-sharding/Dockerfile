# Build Citus from source on official PostgreSQL
FROM postgres:16-bookworm

# Install build dependencies
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
       autoconf \
       build-essential \
       ca-certificates \
       curl \
       flex \
       git \
       libcurl4-openssl-dev \
       libicu-dev \
       libkrb5-dev \
       liblz4-dev \
       libssl-dev \
       libtool \
       libzstd-dev \
       postgresql-server-dev-16 \
       pkg-config \
    && rm -rf /var/lib/apt/lists/*

# Clone and build Citus 12.1 (sequential build to avoid parallel issues)
RUN git clone --branch v12.1.6 --depth 1 https://github.com/citusdata/citus.git /tmp/citus \
    && cd /tmp/citus \
    && ./configure \
    && make \
    && make install \
    && rm -rf /tmp/citus

# Configure PostgreSQL to preload Citus library and enable logical replication
# NOTE: This only LOADS the library - it does NOT create the extension!
# The extension is created explicitly in Phase 2 with CREATE EXTENSION citus
# wal_level=logical is required for shard rebalancing operations
RUN echo "shared_preload_libraries = 'citus'" >> /usr/share/postgresql/postgresql.conf.sample \
    && echo "wal_level = 'logical'" >> /usr/share/postgresql/postgresql.conf.sample
