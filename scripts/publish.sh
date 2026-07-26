#!/bin/sh

set -eu

: "${TAG_VERSION:?TAG_VERSION must contain the GitHub Release tag}"
: "${GIT_HEAD:?GIT_HEAD must contain the release commit SHA}"
: "${NPM_TAG:?NPM_TAG must be latest or next}"
: "${RELEASE_PRERELEASE:?RELEASE_PRERELEASE must be true or false}"

vp install --frozen-lockfile
vp run build

mkdir -p ./dist
release_dir="$(mktemp -d "${PWD%/}/dist/imgfmt-release.XXXXXX")"
artifact_root="${RUNNER_TEMP:-/tmp}"
artifact_dir="$(mktemp -d "${artifact_root%/}/imgfmt-artifact.XXXXXX")"
tarball="${artifact_dir}/imgfmt.tgz"
export RELEASE_DIR="$release_dir"
export RELEASE_TARBALL="$tarball"

trap 'rm -rf "$release_dir" "$artifact_dir"' EXIT HUP INT TERM

vp run release:prepare

vp exec pnpm --dir "$release_dir" pack --out "$tarball" --json
vp run release:verify

cd "$release_dir"
npm publish "$tarball" \
  --access public \
  --registry https://registry.npmjs.org/ \
  --tag "$NPM_TAG"

echo "Published imgfmt@${TAG_VERSION} with npm tag ${NPM_TAG}"
