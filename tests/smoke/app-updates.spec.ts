import { expect, test } from '@playwright/test'
import {
  __testOnlyCompareSemver,
  __testOnlyIsUpdateAvailable,
  __testOnlyShouldStartPackagedUpdateCheck,
} from '../../src/main/app-updates'

test('semver comparison handles v-prefix and major/minor/patch ordering', () => {
  expect(__testOnlyCompareSemver('v1.2.3', '1.2.3')).toBe(0)
  expect(__testOnlyCompareSemver('1.2.4', '1.2.3')).toBeGreaterThan(0)
  expect(__testOnlyCompareSemver('1.3.0', '1.2.99')).toBeGreaterThan(0)
  expect(__testOnlyCompareSemver('2.0.0', '1.99.99')).toBeGreaterThan(0)
  expect(__testOnlyCompareSemver('1.1.9', '1.2.0')).toBeLessThan(0)
})

test('semver comparison tolerates prerelease/build suffixes', () => {
  expect(__testOnlyCompareSemver('v1.2.3-beta.1', '1.2.3')).toBe(0)
  expect(__testOnlyCompareSemver('1.2.3+build.9', 'v1.2.3')).toBe(0)
  expect(__testOnlyCompareSemver('1.2.4-rc.1', '1.2.3')).toBeGreaterThan(0)
})

test('update availability is true only when latest is newer than current', () => {
  expect(__testOnlyIsUpdateAvailable('1.1.0', '1.1.1')).toBe(true)
  expect(__testOnlyIsUpdateAvailable('1.2.0', '1.2.0')).toBe(false)
  expect(__testOnlyIsUpdateAvailable('1.3.0', '1.2.9')).toBe(false)
  expect(__testOnlyIsUpdateAvailable('not-semver', '1.2.0')).toBe(false)
  expect(__testOnlyIsUpdateAvailable('1.2.0', 'not-semver')).toBe(false)
})

test('packaged updater cadence helper enforces interval boundary', () => {
  expect(__testOnlyShouldStartPackagedUpdateCheck(30_000, 0, 30_000)).toBe(true)
  expect(__testOnlyShouldStartPackagedUpdateCheck(29_999, 0, 30_000)).toBe(false)
  expect(__testOnlyShouldStartPackagedUpdateCheck(100_000, 75_000, 30_000)).toBe(false)
  expect(__testOnlyShouldStartPackagedUpdateCheck(105_000, 75_000, 30_000)).toBe(true)
})
