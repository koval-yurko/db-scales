# Build Citus on top of standard PostgreSQL
FROM postgres:16

# Install build dependencies and Citus
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
       ca-certificates \
       curl \
       gnupg \
       lsb-release \
    # Add Citus repository
    && curl https://install.citusdata.com/community/deb.sh | bash \
    # Install Citus extension for PostgreSQL 16
    && apt-get install -y --no-install-recommends \
       postgresql-16-citus-12.1 \
    # Cleanup
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# Configure PostgreSQL to preload Citus library
# NOTE: This only LOADS the library - it does NOT create the extension!
# The extension is created explicitly in Phase 2 with CREATE EXTENSION citus
RUN echo "shared_preload_libraries = 'citus'" >> /usr/share/postgresql/postgresql.conf.sample
