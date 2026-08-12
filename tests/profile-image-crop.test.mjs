import assert from "node:assert/strict";
import test from "node:test";

import {
  buildCroppedProfileImageFileName,
  isSupportedProfileImageType,
  PROFILE_IMAGE_SOURCE_MAX_DIMENSION,
  PROFILE_IMAGE_SOURCE_MAX_PIXELS,
  validateProfileImageDimensions,
} from "../src/lib/profile-image-crop.mjs";

test("profile crop accepts only browser-decodable photo formats", () => {
  assert.equal(isSupportedProfileImageType("image/jpeg"), true);
  assert.equal(isSupportedProfileImageType("image/png"), true);
  assert.equal(isSupportedProfileImageType("image/webp"), true);
  assert.equal(isSupportedProfileImageType("image/svg+xml"), false);
  assert.equal(isSupportedProfileImageType("image/gif"), false);
});

test("profile crop output names are canonical JPEG paths", () => {
  assert.equal(buildCroppedProfileImageFileName("My Photo.PNG"), "my-photo-cropped.jpg");
  assert.equal(buildCroppedProfileImageFileName("../../unsafe.svg"), "unsafe-cropped.jpg");
  assert.equal(buildCroppedProfileImageFileName(""), "profile-picture-cropped.jpg");
});

test("profile crop rejects oversized decoded images", () => {
  assert.equal(validateProfileImageDimensions(4_000, 4_000), true);
  assert.equal(validateProfileImageDimensions(PROFILE_IMAGE_SOURCE_MAX_DIMENSION + 1, 10), false);
  assert.equal(validateProfileImageDimensions(PROFILE_IMAGE_SOURCE_MAX_PIXELS, 2), false);
  assert.equal(validateProfileImageDimensions(0, 500), false);
});
