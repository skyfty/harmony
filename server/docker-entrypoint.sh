#!/bin/sh
set -eu

if [ "${HARMONY_RUN_RESOURCE_CATEGORY_MIGRATION:-1}" = "1" ]; then
  echo '[server-entrypoint] running resource-category migration'
  node dist/scripts/migrate-resource-categories.js
fi

exec "$@"