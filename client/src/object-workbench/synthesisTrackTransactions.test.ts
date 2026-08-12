import { describe, expect, it } from 'vitest'
import { createEmptySynthesisUnit } from './synthesisUnit'
import {
  moveHTokenEvent,
  replaceMidiPFrame,
  moveMidiPFrame,
  replaceHTokenTrackRange,
  replaceKanaTrackRange,
  replaceMidiPTrack,
  replaceSegmentTrack,
  moveKanaSharedBoundary,
  updateKanaUnit,
  updateSegmentObject,
} from './synthesisTrackTransactions'

describe('SynthesisUnit track transactions', () => {
  it('replaces only the requested H range and leaves every other track unchanged', () => {
    const unit = fixtureUnit()
    replaceSegmentTrack(unit, {
      operation: 'fixture segment',
      origin: 'user',
      items: [{
        id: 'segment:1', text: 'test', kana: 'てすと', romaji: 'tesuto',
        startFrame: 2, speechEndFrameExclusive: 12, origin: 'user',
      }],
      now: '2026-08-10T00:00:00.000Z',
      revisionId: 'revision:segment:1',
    })
    replaceKanaTrackRange(unit, {
      operation: 'fixture kana',
      origin: 'user',
      startFrame: 2,
      endFrameExclusive: 12,
      units: [{
        id: 'kana:1', kana: 'て', romaji: 'te', startFrame: 2, endFrameExclusive: 5, origin: 'user',
      }],
      boundaries: [{ id: 'seg:1', frame: 11, kind: 'SEG', origin: 'user' }],
      now: '2026-08-10T00:00:00.000Z',
      revisionId: 'revision:kana:1',
    })
    replaceMidiPTrack(unit, {
      operation: 'fixture midi',
      origin: 'user',
      classes: Array(16).fill(120),
      now: '2026-08-10T00:00:00.000Z',
      revisionId: 'revision:midi:1',
    })
    replaceHTokenTrackRange(unit, {
      operation: 'fixture H',
      origin: 'user',
      startFrame: 0,
      endFrameExclusive: 16,
      events: [
        { id: 'h:k', frame: 2, tokenId: 325, origin: 'user' },
        { id: 'h:i', frame: 6, tokenId: 10, origin: 'user' },
        { id: 'h:sep', frame: 15, tokenId: 365, origin: 'user' },
      ],
      now: '2026-08-10T00:00:00.000Z',
      revisionId: 'revision:h:1',
    })
    const before = structuredClone({
      segment: unit.synthesisUnit.segmentTrack,
      kana: unit.synthesisUnit.kanaTrack,
      midi: unit.synthesisUnit.midiPTokenTrack,
    })

    replaceHTokenTrackRange(unit, {
      operation: 'Segment -> H',
      origin: 'alignment',
      startFrame: 2,
      endFrameExclusive: 10,
      events: [
        { id: 'h:t', frame: 3, tokenId: 23, origin: 'segment-align' },
        { id: 'h:e', frame: 7, tokenId: 16, origin: 'segment-align' },
      ],
      now: '2026-08-10T01:00:00.000Z',
      revisionId: 'revision:h:2',
    })

    expect(unit.synthesisUnit.hTokenTrack.events.map(event => [event.frame, event.tokenId])).toEqual([
      [3, 23], [7, 16], [15, 365],
    ])
    expect(unit.synthesisUnit.hTokenTrack.revision).toBe(2)
    expect(unit.synthesisUnit.hTokenTrack.revisions[1]).toMatchObject({
      affectedStartFrame: 2,
      affectedEndFrameExclusive: 10,
    })
    expect(unit.synthesisUnit.segmentTrack).toEqual(before.segment)
    expect(unit.synthesisUnit.kanaTrack).toEqual(before.kana)
    expect(unit.synthesisUnit.midiPTokenTrack).toEqual(before.midi)
  })

  it('requires MIDI-P to be dense over the fixed frame contract', () => {
    const unit = fixtureUnit()
    expect(() => replaceMidiPTrack(unit, {
      operation: 'GAME',
      origin: 'game',
      classes: [120],
    })).toThrow('MIDI-P requires 16 dense classes')
    expect(() => replaceMidiPTrack(unit, {
      operation: 'invalid PAD',
      origin: 'user',
      classes: [...Array(15).fill(120), 256],
    })).toThrow('PAD=256')
    replaceMidiPTrack(unit, { operation: 'valid MIDI-P', origin: 'user', classes: Array(16).fill(120) })
    expect(() => replaceMidiPFrame(unit, { frame: 0, midiClass: 256 })).toThrow('PAD=256')
  })

  it('materializes FLOW only while writing an automatic GAME track', () => {
    const unit = fixtureUnit()
    const classes = [255, 120, 120, 120, 255, 120, 120, 121, 121, 255, 255, 122, 123, 123, 255, 255]
    replaceMidiPTrack(unit, { operation: 'GAME', origin: 'game', classes })

    expect(unit.synthesisUnit.midiPTokenTrack.flowFrames).toEqual([2, 3, 6, 8, 13])
    replaceMidiPFrame(unit, { frame: 3, midiClass: 120 })
    expect(unit.synthesisUnit.midiPTokenTrack.flowFrames).toEqual([2, 6, 8, 13])
  })

  it('blocks H collisions unless force replacement is explicit', () => {
    const unit = fixtureUnit()
    replaceHTokenTrackRange(unit, {
      operation: 'fixture H', origin: 'user', startFrame: 0, endFrameExclusive: 16,
      events: [
        { id: 'h:a', frame: 2, tokenId: 319, origin: 'user' },
        { id: 'h:b', frame: 5, tokenId: 325, origin: 'user' },
      ],
    })

    expect(() => moveHTokenEvent(unit, { eventId: 'h:a', targetFrame: 5 })).toThrow('显式强制替换')
    moveHTokenEvent(unit, { eventId: 'h:a', targetFrame: 5, forceReplace: true })
    expect(unit.synthesisUnit.hTokenTrack.events).toMatchObject([
      { id: 'h:a', frame: 5, tokenId: 319 },
    ])
  })

  it('clears stale H placement provenance after manual replacement or movement', () => {
    const unit = fixtureUnit()
    replaceHTokenTrackRange(unit, {
      operation: 'aligned H', origin: 'alignment', startFrame: 0, endFrameExclusive: 16,
      events: [{ id: 'h:a', frame: 2, tokenId: 319, origin: 'segment-align' }],
      placementRanges: [{ phraseId: 'phrase:1', startFrame: 0, endFrameExclusive: 8, placementMode: 'phone', fallbackReason: null }],
    })

    replaceHTokenTrackRange(unit, {
      operation: 'manual H', origin: 'user', startFrame: 2, endFrameExclusive: 3,
      events: [{ id: 'h:b', frame: 2, tokenId: 325, origin: 'user' }],
    })
    expect(unit.synthesisUnit.hTokenTrack.placementRanges).toEqual([])

    replaceHTokenTrackRange(unit, {
      operation: 'aligned H again', origin: 'alignment', startFrame: 0, endFrameExclusive: 8,
      events: [{ id: 'h:c', frame: 2, tokenId: 319, origin: 'segment-align' }],
      placementRanges: [{ phraseId: 'phrase:2', startFrame: 0, endFrameExclusive: 8, placementMode: 'phone', fallbackReason: null }],
    })
    moveHTokenEvent(unit, { eventId: 'h:c', targetFrame: 4 })
    expect(unit.synthesisUnit.hTokenTrack.placementRanges).toEqual([])
  })

  it('makes explicit FLOW followers track a changed head pitch', () => {
    const unit = fixtureUnit()
    replaceMidiPTrack(unit, { operation: 'GAME', origin: 'game', classes: Array(16).fill(120) })
    replaceMidiPFrame(unit, { frame: 7, midiClass: 121 })

    expect(unit.synthesisUnit.midiPTokenTrack.classes.slice(6, 9)).toEqual([120, 121, 121])
    expect(unit.synthesisUnit.midiPTokenTrack.flowFrames.includes(7)).toBe(false)
    expect(unit.synthesisUnit.midiPTokenTrack.flowFrames.includes(8)).toBe(true)
    expect(unit.synthesisUnit.midiPTokenTrack.manualFrames).toEqual([7, 8, 9, 10, 11, 12, 13, 14, 15])
    expect(unit.synthesisUnit.midiPTokenTrack.revisions.at(-1)).toMatchObject({
      affectedStartFrame: 7,
      affectedEndFrameExclusive: 16,
    })
  })

  it('moves a note head vertically with all of its FLOW frames', () => {
    const unit = fixtureUnit()
    replaceMidiPTrack(unit, { operation: 'GAME', origin: 'game', classes: Array(16).fill(120) })
    moveMidiPFrame(unit, { sourceFrame: 0, targetFrame: 0, targetClass: 124 })

    expect(unit.synthesisUnit.midiPTokenTrack.classes).toEqual(Array(16).fill(124))
    expect(unit.synthesisUnit.midiPTokenTrack.flowFrames).toEqual(Array.from({ length: 15 }, (_, index) => index + 1))
  })

  it('moves one MIDI-P cell horizontally and leaves REST at its source frame', () => {
    const unit = fixtureUnit()
    const classes = Array(16).fill(255)
    classes.splice(4, 5, 120, 120, 120, 120, 120)
    replaceMidiPTrack(unit, { operation: 'GAME', origin: 'game', classes })
    moveMidiPFrame(unit, {
      sourceFrame: 4,
      targetFrame: 9,
      targetClass: 123,
      forceReplace: true,
      operation: 'move MIDI-P token',
    })

    expect(unit.synthesisUnit.midiPTokenTrack.classes[4]).toBe(255)
    expect(unit.synthesisUnit.midiPTokenTrack.classes[9]).toBe(123)
    expect(unit.synthesisUnit.midiPTokenTrack.classes.slice(5, 9)).toEqual([120, 120, 120, 120])
    expect(unit.synthesisUnit.midiPTokenTrack.flowFrames).toEqual([6, 7, 8])
    expect(unit.synthesisUnit.midiPTokenTrack.manualFrames).toEqual([4, 5, 6, 7, 8, 9])
    expect(unit.synthesisUnit.midiPTokenTrack.revisions.at(-1)).toMatchObject({
      affectedStartFrame: 4,
      affectedEndFrameExclusive: 10,
    })
  })

  it('blocks a horizontal move onto a manual MIDI-P frame unless forced', () => {
    const unit = fixtureUnit()
    const classes = Array(16).fill(255)
    classes[4] = 120
    classes[9] = 120
    replaceMidiPTrack(unit, { operation: 'GAME', origin: 'game', classes })
    replaceMidiPFrame(unit, { frame: 9, midiClass: 130 })

    expect(() => moveMidiPFrame(unit, { sourceFrame: 4, targetFrame: 9, targetClass: 123 }))
      .toThrow('显式强制移动')
  })

  it('edits a Segment boundary without propagating into H or MIDI-P', () => {
    const unit = fixtureUnit()
    replaceSegmentTrack(unit, {
      operation: 'Whisper', origin: 'whisper-sofa',
      items: [{ id: 'segment:a', text: 'a', kana: 'あ', romaji: 'a', startFrame: 2, speechEndFrameExclusive: 10, origin: 'whisper-sofa' }],
    })
    replaceHTokenTrackRange(unit, {
      operation: 'H', origin: 'alignment', startFrame: 0, endFrameExclusive: 16,
      events: [{ id: 'h:a', frame: 2, tokenId: 211, origin: 'segment-align' }],
    })
    replaceMidiPTrack(unit, { operation: 'GAME', origin: 'game', classes: Array(16).fill(120) })
    const hBefore = structuredClone(unit.synthesisUnit.hTokenTrack)
    const midiBefore = structuredClone(unit.synthesisUnit.midiPTokenTrack)

    updateSegmentObject(unit, { segmentId: 'segment:a', patch: { startFrame: 3, text: 'A' } })

    expect(unit.synthesisUnit.segmentTrack.items[0]).toMatchObject({ startFrame: 3, text: 'A', origin: 'user' })
    expect(unit.synthesisUnit.hTokenTrack).toEqual(hBefore)
    expect(unit.synthesisUnit.midiPTokenTrack).toEqual(midiBefore)
  })

  it('edits Kana content and moves only the shared integer boundary', () => {
    const unit = fixtureUnit()
    replaceKanaTrackRange(unit, {
      operation: 'Segment -> Kana', origin: 'alignment', startFrame: 2, endFrameExclusive: 10,
      units: [
        { id: 'kana:a', kana: 'き', romaji: 'ki', startFrame: 2, endFrameExclusive: 6, origin: 'segment-align' },
        { id: 'kana:b', kana: 'み', romaji: 'mi', startFrame: 6, endFrameExclusive: 10, origin: 'segment-align' },
      ],
      boundaries: [],
    })
    const hRevision = unit.synthesisUnit.hTokenTrack.revision
    updateKanaUnit(unit, { unitId: 'kana:a', patch: { kana: 'ぎ', romaji: 'gi' } })
    moveKanaSharedBoundary(unit, { leftUnitId: 'kana:a', rightUnitId: 'kana:b', targetFrame: 7 })
    expect(unit.synthesisUnit.kanaTrack.units).toMatchObject([
      { id: 'kana:a', kana: 'ぎ', startFrame: 2, endFrameExclusive: 7, origin: 'user' },
      { id: 'kana:b', startFrame: 7, endFrameExclusive: 10, origin: 'user' },
    ])
    expect(unit.synthesisUnit.hTokenTrack.revision).toBe(hRevision)
  })

  it('stores a Kana SEG at the next phrase anchor without expanding the mora replacement range', () => {
    const unit = fixtureUnit()
    replaceKanaTrackRange(unit, {
      operation: 'Segment -> Kana', origin: 'alignment', startFrame: 2, endFrameExclusive: 8,
      boundaryEndFrameExclusive: 11,
      units: [
        { id: 'kana:a', kana: 'き', romaji: 'ki', startFrame: 2, endFrameExclusive: 5, origin: 'segment-align' },
        { id: 'kana:b', kana: 'み', romaji: 'mi', startFrame: 5, endFrameExclusive: 8, origin: 'segment-align' },
      ],
      boundaries: [{ id: 'seg:a', frame: 10, kind: 'SEG', origin: 'segment-align' }],
    })
    expect(unit.synthesisUnit.kanaTrack.boundaries).toMatchObject([{ frame: 10, kind: 'SEG' }])
    expect(unit.synthesisUnit.kanaTrack.revisions.at(-1)).toMatchObject({
      affectedStartFrame: 2,
      affectedEndFrameExclusive: 11,
    })

    replaceKanaTrackRange(unit, {
      operation: 'next Segment -> Kana', origin: 'alignment', startFrame: 10, endFrameExclusive: 15,
      units: [{ id: 'kana:c', kana: 'の', romaji: 'no', startFrame: 10, endFrameExclusive: 15, origin: 'segment-align' }],
      boundaries: [],
    })
    expect(unit.synthesisUnit.kanaTrack.boundaries).toMatchObject([{ frame: 10, kind: 'SEG' }])
  })
})

function fixtureUnit() {
  return createEmptySynthesisUnit({
    id: 'node:synthesisUnit:test',
    name: 'Fixture',
    defaultTimelineStart: null,
    guide: {
      assetId: 'asset:guide:test',
      audioSHA256: 'a'.repeat(64),
      sampleRate: 44100,
      channels: 1,
      sampleCount: 16 * 2048,
      duration: 16 * 2048 / 44100,
      source: {
        sourceAudioObjectId: 'node:audio:test',
        sourceAssetId: 'asset:audio:test',
        effectiveStartSample: 0,
        effectiveEndSampleExclusive: 16 * 2048,
        sourceTimelineStart: null,
        resolverManifest: 'fixture',
      },
    },
  })
}
