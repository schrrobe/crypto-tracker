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

  it('entschärft Formel-Injection (= + @) mit führendem Apostroph', () => {
    const csv = buildCsv(
      ['Quelle'],
      [['=HYPERLINK("http://evil","x")'], ['@SUM(A1)'], ['+1+cmd|calc']],
    )
    // = und @ werden mit Apostroph neutralisiert; das =-Beispiel enthält zudem ; / "
    expect(csv).toBe(
      'Quelle\r\n' +
        '"\'=HYPERLINK(""http://evil"",""x"")"\r\n' +
        "'@SUM(A1)\r\n" +
        "'+1+cmd|calc",
    )
  })

  it('lässt vorzeichenbehaftete Zahlen und deutsche Dezimalkommas numerisch', () => {
    // Verluste (-1234,56) dürfen NICHT zu Text werden — sonst bricht die Geldspalte
    expect(buildCsv(['x'], [['-1234,56'], ['+5'], ['0,00']])).toBe('x\r\n-1234,56\r\n+5\r\n0,00')
  })
})
