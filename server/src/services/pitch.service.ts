import { spawn } from 'child_process'
import fs from 'fs'
import path from 'path'

const PROJECT_ROOT = 'E:/AIscene/AISVC-midi-web'
const DATA_ROOT = path.resolve(PROJECT_ROOT, 'data')
const PYTHON = 'E:/AIscene/AISVCs/.venv/Scripts/python.exe'
const COMPARE_SCRIPT = path.resolve(PROJECT_ROOT, 'server/scripts/pitch_compare.py')
const FFMPEG = 'C:/ffmpeg-shared/ffmpeg-8.1.1-full_build-shared/bin/ffmpeg.exe'
const FFPROBE = 'C:/ffmpeg-shared/ffmpeg-8.1.1-full_build-shared/bin/ffprobe.exe'

export interface PitchComparison {
  referenceMedianMidi: number
  targetMedianMidi: number
  suggestedTargetShift: number
  suggestedReferenceShift: number
  referenceVoicedFrames: number
  targetVoicedFrames: number
  pitchClassScore: number
}

export async function compareAudioPitch(referencePath: string, targetPath: string): Promise<PitchComparison> {
  const reference = requireTempWav(referencePath)
  const target = requireTempWav(targetPath)
  const output = await runProcess(PYTHON, [COMPARE_SCRIPT, reference, target])
  const parsed = JSON.parse(output)
  if (parsed.error) throw new Error(parsed.error)
  return parsed as PitchComparison
}

export async function pitchShiftAudio(inputPath: string, semitones: number): Promise<string> {
  const input = requireTempWav(inputPath)
  if (!Number.isInteger(semitones) || semitones < -24 || semitones > 24) {
    throw new Error('pitch shift must be an integer from -24 to 24 semitones')
  }
  if (semitones === 0) return input
  const suffix = semitones > 0 ? `p${semitones}` : `m${Math.abs(semitones)}`
  const output = path.join(path.dirname(input), `${path.basename(input, path.extname(input))}.pitch_${suffix}.wav`)
  const ratio = Math.pow(2, semitones / 12)
  const durationText = await runProcess(FFPROBE, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', input])
  const duration = Number(durationText)
  if (!Number.isFinite(duration) || duration <= 0) throw new Error('could not read input WAV duration')
  await runProcess(FFMPEG, [
    '-y', '-hide_banner', '-loglevel', 'error',
    '-i', input,
    '-af', `rubberband=pitch=${ratio.toFixed(9)}:formant=preserved:pitchq=quality,apad,atrim=duration=${duration.toFixed(9)}`,
    '-c:a', 'pcm_f32le',
    output,
  ])
  if (!fs.existsSync(output) || fs.statSync(output).size === 0) throw new Error('pitch-shifted WAV was not created')
  return output
}

function requireTempWav(inputPath: string): string {
  const resolved = path.resolve(inputPath)
  const relative = path.relative(DATA_ROOT, resolved)
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('audio path is outside the temporary data directory')
  if (path.extname(resolved).toLowerCase() !== '.wav' || !fs.existsSync(resolved)) throw new Error(`temporary WAV does not exist: ${resolved}`)
  return resolved
}

function runProcess(command: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', data => { stdout += data.toString() })
    child.stderr.on('data', data => { stderr += data.toString() })
    child.on('error', reject)
    child.on('close', code => {
      if (code === 0) resolve(stdout.trim())
      else reject(new Error(stderr.trim() || stdout.trim() || `process exited with code ${code}`))
    })
  })
}
