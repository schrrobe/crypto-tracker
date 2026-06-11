import { describe, expect, it } from 'vitest'
import { buildCsv } from './download'

describe('buildCsv', () => {
  it('verbindet Header und Zeilen mit Semikolon und CRLF', () => {
    const csv = buildCsv(['A', 'B'], [['1', '2'], ['3', '4']])
    expect(csv).toBe('A;B\r\n1;2\r\n3;4')
  })

  it('quotet Zellen mit Semikolon, Anführungszeichen oder Zeilenumbruch', () => {
    const csv = buildCsv(['Name'], [['mit;semikolon'], ['mit "quote"'], ['mit\numbruch']])
    expect(csv).toBe('Name\r\n"mit;semikolon"\r\n"mit ""quote"""\r\n"mit\numbruch"')
  })

  it('lässt Zahlen und einfache Strings unangetastet', () => {
    expect(buildCsv(['n'], [[1.5], ['text']])).toBe('n\r\n1.5\r\ntext')
  })
})
