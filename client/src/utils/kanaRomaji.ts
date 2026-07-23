const kanaToRomajiMap: Record<string, string> = {
  あ: 'a', い: 'i', う: 'u', え: 'e', お: 'o',
  か: 'ka', き: 'ki', く: 'ku', け: 'ke', こ: 'ko',
  さ: 'sa', し: 'shi', す: 'su', せ: 'se', そ: 'so',
  た: 'ta', ち: 'chi', つ: 'tsu', て: 'te', と: 'to',
  な: 'na', に: 'ni', ぬ: 'nu', ね: 'ne', の: 'no',
  は: 'ha', ひ: 'hi', ふ: 'fu', へ: 'he', ほ: 'ho',
  ま: 'ma', み: 'mi', む: 'mu', め: 'me', も: 'mo',
  や: 'ya', ゆ: 'yu', よ: 'yo',
  ら: 'ra', り: 'ri', る: 'ru', れ: 're', ろ: 'ro',
  わ: 'wa', を: 'wo', ん: 'n',
  が: 'ga', ぎ: 'gi', ぐ: 'gu', げ: 'ge', ご: 'go',
  ざ: 'za', じ: 'ji', ず: 'zu', ぜ: 'ze', ぞ: 'zo',
  だ: 'da', ぢ: 'ji', づ: 'zu', で: 'de', ど: 'do',
  ば: 'ba', び: 'bi', ぶ: 'bu', べ: 'be', ぼ: 'bo',
  ぱ: 'pa', ぴ: 'pi', ぷ: 'pu', ぺ: 'pe', ぽ: 'po',
  ぁ: 'a', ぃ: 'i', ぅ: 'u', ぇ: 'e', ぉ: 'o', ゃ: 'ya', ゅ: 'yu', ょ: 'yo', っ: 'tsu',
}

const digraphs: Record<string, string> = {
  きゃ: 'kya', きゅ: 'kyu', きょ: 'kyo',
  しゃ: 'sha', しゅ: 'shu', しょ: 'sho',
  ちゃ: 'cha', ちゅ: 'chu', ちょ: 'cho',
  にゃ: 'nya', にゅ: 'nyu', にょ: 'nyo',
  ひゃ: 'hya', ひゅ: 'hyu', ひょ: 'hyo',
  みゃ: 'mya', みゅ: 'myu', みょ: 'myo',
  りゃ: 'rya', りゅ: 'ryu', りょ: 'ryo',
  ぎゃ: 'gya', ぎゅ: 'gyu', ぎょ: 'gyo',
  じゃ: 'ja', じゅ: 'ju', じょ: 'jo',
  びゃ: 'bya', びゅ: 'byu', びょ: 'byo',
  ぴゃ: 'pya', ぴゅ: 'pyu', ぴょ: 'pyo',
}

const romajiToKanaEntries = Object.entries({ ...kanaToRomajiMap, ...digraphs })
  .map(([kana, romaji]) => [romaji, kana] as const)
  .sort((a, b) => b[0].length - a[0].length)

export function kanaToRomaji(input: string): string {
  const hira = toHiragana(input)
  const pieces: string[] = []
  for (let index = 0; index < hira.length; index++) {
    const two = hira.slice(index, index + 2)
    if (digraphs[two]) {
      pieces.push(digraphs[two])
      index++
      continue
    }
    const char = hira[index]
    if (char === 'ー') {
      pieces.push('-')
      continue
    }
    pieces.push(kanaToRomajiMap[char] ?? char)
  }
  return pieces.join(' ')
}

export function romajiToKana(input: string): string {
  return input.split(/(\s+|[|、。，．？！!?]+)/).map(token => {
    if (!token || /^\s+$/.test(token) || /^[|、。，．？！!?]+$/.test(token)) return token
    return romanTokenToKana(token.toLowerCase())
  }).join('').replace(/\s+/g, '')
}

function romanTokenToKana(token: string): string {
  let result = ''
  let rest = token
  while (rest.length > 0) {
    if (rest.length >= 2 && rest[0] === rest[1] && !'aeioun'.includes(rest[0])) {
      result += 'っ'
      rest = rest.slice(1)
      continue
    }
    const matched = romajiToKanaEntries.find(([romaji]) => rest.startsWith(romaji))
    if (matched) {
      result += matched[1]
      rest = rest.slice(matched[0].length)
      continue
    }
    result += rest[0]
    rest = rest.slice(1)
  }
  return result
}

function toHiragana(input: string): string {
  return input.replace(/[ァ-ン]/g, char => String.fromCharCode(char.charCodeAt(0) - 0x60))
}
