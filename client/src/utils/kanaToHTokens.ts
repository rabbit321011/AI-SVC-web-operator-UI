import { V5P_H_TOKEN_CATALOG } from '@/generated/v5pHTokenCatalog'

export interface DirectHToken {
  tokenId: number
  symbol: string
}

type MoraDefinition = [string, string | null, string]

const vowelSymbols: Record<string, string> = {
  a: 'a',
  i: 'i',
  u: 'ɯ',
  e: 'e',
  o: 'o',
}

const onsetSymbols: Record<string, string[]> = {
  k: ['k'], s: ['s'], t: ['t'], n: ['n'], h: ['ç'], f: ['ɸ'],
  m: ['m'], y: ['j'], r: ['ɾ'], w: ['ɰᵝ'], g: ['g'], j: ['dʑ'],
  z: ['z'], d: ['d'], b: ['b'], p: ['p'],
  sh: ['ɕ'], ch: ['tɕ'], ts: ['tsɯ'],
  by: ['bj'], dy: ['dej'], gy: ['gj'], gw: ['gɯ'], hy: ['çj'],
  ky: ['kj'], kw: ['kɯ'], my: ['mj'], ny: ['nj'], py: ['pj'],
  ry: ['ɾj'], ty: ['tej'],
}

const moraDefinitions: MoraDefinition[] = [
  ['ア', null, 'a'], ['イ', null, 'i'], ['ウ', null, 'u'], ['エ', null, 'e'], ['オ', null, 'o'],
  ['カ', 'k', 'a'], ['キ', 'k', 'i'], ['ク', 'k', 'u'], ['ケ', 'k', 'e'], ['コ', 'k', 'o'],
  ['ガ', 'g', 'a'], ['ギ', 'g', 'i'], ['グ', 'g', 'u'], ['ゲ', 'g', 'e'], ['ゴ', 'g', 'o'],
  ['サ', 's', 'a'], ['シ', 'sh', 'i'], ['ス', 's', 'u'], ['セ', 's', 'e'], ['ソ', 's', 'o'],
  ['ザ', 'z', 'a'], ['ジ', 'j', 'i'], ['ズ', 'z', 'u'], ['ゼ', 'z', 'e'], ['ゾ', 'z', 'o'],
  ['タ', 't', 'a'], ['チ', 'ch', 'i'], ['ツ', 'ts', 'u'], ['テ', 't', 'e'], ['ト', 't', 'o'],
  ['ダ', 'd', 'a'], ['ヂ', 'j', 'i'], ['ヅ', 'z', 'u'], ['デ', 'd', 'e'], ['ド', 'd', 'o'],
  ['ナ', 'n', 'a'], ['ニ', 'n', 'i'], ['ヌ', 'n', 'u'], ['ネ', 'n', 'e'], ['ノ', 'n', 'o'],
  ['ハ', 'h', 'a'], ['ヒ', 'h', 'i'], ['フ', 'f', 'u'], ['ヘ', 'h', 'e'], ['ホ', 'h', 'o'],
  ['バ', 'b', 'a'], ['ビ', 'b', 'i'], ['ブ', 'b', 'u'], ['ベ', 'b', 'e'], ['ボ', 'b', 'o'],
  ['パ', 'p', 'a'], ['ピ', 'p', 'i'], ['プ', 'p', 'u'], ['ペ', 'p', 'e'], ['ポ', 'p', 'o'],
  ['マ', 'm', 'a'], ['ミ', 'm', 'i'], ['ム', 'm', 'u'], ['メ', 'm', 'e'], ['モ', 'm', 'o'],
  ['ヤ', 'y', 'a'], ['ユ', 'y', 'u'], ['ヨ', 'y', 'o'],
  ['ラ', 'r', 'a'], ['リ', 'r', 'i'], ['ル', 'r', 'u'], ['レ', 'r', 'e'], ['ロ', 'r', 'o'],
  ['ワ', 'w', 'a'], ['ヲ', null, 'o'], ['ン', null, 'N'],
  ['キャ', 'ky', 'a'], ['キュ', 'ky', 'u'], ['キョ', 'ky', 'o'],
  ['ギャ', 'gy', 'a'], ['ギュ', 'gy', 'u'], ['ギョ', 'gy', 'o'],
  ['シャ', 'sh', 'a'], ['シュ', 'sh', 'u'], ['ショ', 'sh', 'o'],
  ['ジャ', 'j', 'a'], ['ジュ', 'j', 'u'], ['ジョ', 'j', 'o'],
  ['チャ', 'ch', 'a'], ['チュ', 'ch', 'u'], ['チョ', 'ch', 'o'],
  ['ニャ', 'ny', 'a'], ['ニュ', 'ny', 'u'], ['ニョ', 'ny', 'o'],
  ['ヒャ', 'hy', 'a'], ['ヒュ', 'hy', 'u'], ['ヒョ', 'hy', 'o'],
  ['ビャ', 'by', 'a'], ['ビュ', 'by', 'u'], ['ビョ', 'by', 'o'],
  ['ピャ', 'py', 'a'], ['ピュ', 'py', 'u'], ['ピョ', 'py', 'o'],
  ['ミャ', 'my', 'a'], ['ミュ', 'my', 'u'], ['ミョ', 'my', 'o'],
  ['リャ', 'ry', 'a'], ['リュ', 'ry', 'u'], ['リョ', 'ry', 'o'],
  ['ティ', 't', 'i'], ['テュ', 'ty', 'u'], ['ディ', 'd', 'i'], ['デュ', 'dy', 'u'],
  ['トゥ', 't', 'u'], ['ドゥ', 'd', 'u'], ['ファ', 'f', 'a'], ['フィ', 'f', 'i'],
  ['フェ', 'f', 'e'], ['フォ', 'f', 'o'], ['ヴァ', 'v', 'a'], ['ヴィ', 'v', 'i'],
  ['ヴェ', 'v', 'e'], ['ヴォ', 'v', 'o'], ['ヴ', 'v', 'u'],
  ['イェ', 'y', 'e'], ['ウィ', 'w', 'i'], ['ウェ', 'w', 'e'], ['ウォ', 'w', 'o'],
]

const moraMap = new Map(moraDefinitions.map(([kana, onset, vowel]) => [kana, [onset, vowel] as const]))
const sortedMoraKeys = [...moraMap.keys()].sort((left, right) => right.length - left.length)
const tokenIdBySymbol = new Map(
  V5P_H_TOKEN_CATALOG.filter(entry => entry.id !== 0 && entry.id !== 364).map(entry => [entry.token, entry.id]),
)

export function kanaToHTokens(input: string): DirectHToken[] {
  const text = toKatakana(input.normalize('NFKC')).replace(/\s+/g, '')
  const symbols: string[] = []
  let lastVowel = ''
  let index = 0
  while (index < text.length) {
    const character = text[index]
    if (character === 'ッ') {
      symbols.push('q')
      index += 1
      continue
    }
    if (character === 'ー') {
      if (!lastVowel) throw new Error('长音符号前没有可延长的元音')
      symbols.push(lastVowel)
      index += 1
      continue
    }
    const punctuation = character === '，' || character === '、' ? ','
      : character === '。' || character === '．' ? '.'
        : character === '！' ? '!' : character === '？' ? '?' : character
    if (',.!?:;\'…'.includes(punctuation)) {
      symbols.push(punctuation)
      index += 1
      continue
    }
    const mora = sortedMoraKeys.find(key => text.startsWith(key, index))
    if (!mora) throw new Error(`Kana “${character}” 暂不支持直接映射至 H token`)
    const [onset, vowel] = moraMap.get(mora)!
    if (vowel === 'N') {
      symbols.push('ɴ')
      lastVowel = ''
    } else {
      if (onset) {
        const mapped = onset === 'v' ? ['v'] : onsetSymbols[onset]
        if (!mapped) throw new Error(`Kana “${mora}” 缺少 H token 映射`)
        symbols.push(...mapped)
      }
      lastVowel = vowelSymbols[vowel]
      symbols.push(lastVowel)
    }
    index += mora.length
  }
  return symbols.map(symbol => {
    const tokenId = tokenIdBySymbol.get(symbol)
    if (tokenId == null) throw new Error(`H 词表中没有 token “${symbol}”`)
    return { tokenId, symbol }
  })
}

function toKatakana(input: string): string {
  return input.replace(/[ぁ-ゖ]/g, character => String.fromCharCode(character.charCodeAt(0) + 0x60))
}
