"use strict"
const isDarwin = process.platform === "darwin"
if (isDarwin) {
  const { app } = require("electron")
  const util = require("util")
  const path = require("path")
  const execa = require("execa")
  const tmp = require("tmp")
  const macosVersion = require("macos-version")

  const debuglog = util.debuglog("aperture")

  const bin =
    process.env.ELECTRON_ENV === "development"
      ? path.join(__dirname, "swift", "main")
      : path.join(
          app.getAppPath(),
          "..",
          "app.asar.unpacked",
          "node_modules",
          "aperture",
          "swift",
          "main"
        )

  class Aperture {
    constructor() {
      macosVersion.assertGreaterThanOrEqualTo("10.10")
    }

    getAudioSources() {
      return execa.stderr(bin, ["list-audio-devices"]).then(stderr => {
        try {
          return JSON.parse(stderr)
        } catch (err) {
          return stderr
        }
      })
    }

    startRecording(
      {
        fps = 30,
        cropArea = "none",
        showCursor = true,
        highlightClicks = false,
        displayId = "main",
        audioSourceId = "none"
      } = {}
    ) {
      return new Promise((resolve, reject) => {
        if (this.recorder !== undefined) {
          reject(new Error("Call `.stopRecording()` first"))
          return
        }

        if (highlightClicks === true) {
          showCursor = true
        }

        this.tmpPath = tmp.tmpNameSync({ postfix: ".mp4" })

        if (typeof cropArea === "object") {
          if (
            typeof cropArea.x !== "number" ||
            typeof cropArea.y !== "number" ||
            typeof cropArea.width !== "number" ||
            typeof cropArea.height !== "number"
          ) {
            reject(new Error("Invalid `cropArea` option object"))
            return
          }

          cropArea = `${cropArea.x}:${cropArea.y}:${cropArea.width}:${cropArea.height}`
        }

        const recorderOpts = [
          this.tmpPath,
          fps,
          cropArea,
          showCursor,
          highlightClicks,
          displayId,
          audioSourceId
        ]

        this.recorder = execa(bin, recorderOpts)

        const timeout = setTimeout(() => {
          // `.stopRecording()` was called already
          if (this.recorder === undefined) {
            return
          }

          const err = new Error("Could not start recording within 5 seconds")
          err.code = "RECORDER_TIMEOUT"
          this.recorder.kill()
          delete this.recorder
          reject(err)
        }, 5000)

        this.recorder.catch(err => {
          clearTimeout(timeout)
          delete this.recorder
          reject(err)
        })

        this.recorder.stdout.setEncoding("utf8")
        this.recorder.stdout.on("data", data => {
          debuglog(data)

          if (data.trim() === "R") {
            // `R` is printed by Swift when the recording **actually** starts
            clearTimeout(timeout)
            resolve(this.tmpPath)
          }
        })
      })
    }

    stopRecording() {
      return new Promise((resolve, reject) => {
        if (this.recorder === undefined) {
          reject(new Error("Call `.startRecording()` first"))
          return
        }

        this.recorder
          .then(() => {
            delete this.recorder
            resolve(this.tmpPath)
          })
          .catch(reject)

        this.recorder.kill()
      })
    }
  }

  module.exports = () => new Aperture()
} else {
  module.exports = () => undefined
}
