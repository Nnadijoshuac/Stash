// Windows can't create paths longer than 260 characters, and the native
// build of React Native libraries goes past that (ninja fails on mkdir).
// CMAKE_OBJECT_PATH_MAX makes CMake shorten long object paths with a hash.
const { withAppBuildGradle } = require('expo/config-plugins')

const MARK = 'CMAKE_OBJECT_PATH_MAX'

module.exports = function withShortCmakePaths(config) {
  return withAppBuildGradle(config, (c) => {
    if (!c.modResults.contents.includes(MARK)) {
      c.modResults.contents = c.modResults.contents.replace(
        /defaultConfig\s*\{/,
        `defaultConfig {\n        externalNativeBuild {\n            cmake {\n                arguments "-D${MARK}=128"\n            }\n        }`,
      )
    }
    return c
  })
}
