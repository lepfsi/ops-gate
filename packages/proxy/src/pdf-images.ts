/**
 * Extraction d’images embarquées dans un PDF (surtout /DCTDecode = JPEG).
 * Cas typique : PDF scanné page-par-page en JPEG.
 * Pas de rendu canvas (portable MSI / sans deps natives).
 */

export type PdfImageExtract = {
  images: Buffer[]
  /** true si plus d’images disponibles que le cap */
  truncated: boolean
  method: "dct" | "none"
}

const JPEG_SOI = Buffer.from([0xff, 0xd8, 0xff])

/**
 * Extrait jusqu’à `maxImages` flux JPEG (DCTDecode) depuis un PDF binaire.
 */
export function extractPdfEmbeddedImages(
  buf: Buffer,
  maxImages = 6
): PdfImageExtract {
  const images: Buffer[] = []
  if (!buf?.length || maxImages <= 0) {
    return { images, truncated: false, method: "none" }
  }

  // latin1 = vue octet-preserving pour indexOf
  const raw = buf.toString("latin1")
  // /Filter /DCTDecode  or  /Filter [ /DCTDecode ]  or /Filter[/DCTDecode]
  const filterRe =
    /\/Filter\s*(?:\/DCTDecode|\[\s*\/DCTDecode\s*\])/gi

  let m: RegExpExecArray | null
  const streamStarts: number[] = []
  while ((m = filterRe.exec(raw)) !== null) {
    // Chercher "stream" dans les ~800 caractères suivants
    const from = m.index
    const window = raw.slice(from, from + 900)
    const streamRel = window.search(/stream[\r\n]/)
    if (streamRel < 0) continue
    // après "stream" + newline
    let dataStart = from + streamRel
    // skip "stream"
    const afterStream = raw.slice(dataStart, dataStart + 12)
    const nl = afterStream.match(/^stream\r?\n/)
    if (!nl) continue
    dataStart += nl[0].length

    // Trouver endstream
    const endRel = raw.indexOf("endstream", dataStart)
    if (endRel < 0) continue
    let dataEnd = endRel
    // trim trailing whitespace before endstream
    while (
      dataEnd > dataStart &&
      (raw[dataEnd - 1] === "\n" ||
        raw[dataEnd - 1] === "\r" ||
        raw[dataEnd - 1] === " ")
    ) {
      dataEnd--
    }

    if (dataEnd - dataStart < 100) continue
    const slice = buf.subarray(dataStart, dataEnd)

    // Vérifier SOI JPEG ; parfois whitespace avant
    let img = slice
    const soi = slice.indexOf(JPEG_SOI)
    if (soi > 0 && soi < 16) img = slice.subarray(soi)
    else if (soi < 0) {
      // pas un JPEG valide
      continue
    } else if (soi > 0) {
      img = slice.subarray(soi)
    }

    // EOI 0xFFD9
    const eoi = img.lastIndexOf(Buffer.from([0xff, 0xd9]))
    if (eoi > 100) {
      img = img.subarray(0, eoi + 2)
    }

    if (img.length < 200) continue
    // dédoublonner par taille+checksum simple
    const dup = images.some(
      (x) => x.length === img.length && x[100] === img[100] && x[200] === img[200]
    )
    if (dup) continue

    images.push(Buffer.from(img))
    streamStarts.push(dataStart)
    if (images.length >= maxImages) {
      // y a-t-il encore des matches ?
      const more = filterRe.exec(raw)
      return {
        images,
        truncated: more != null,
        method: "dct"
      }
    }
  }

  // Fallback : scanner les marqueurs JPEG bruts dans le fichier
  if (images.length === 0) {
    let pos = 0
    while (images.length < maxImages && pos < buf.length - 4) {
      const i = buf.indexOf(JPEG_SOI, pos)
      if (i < 0) break
      // trouver EOI
      let j = i + 3
      let found = -1
      while (j < buf.length - 1) {
        if (buf[j] === 0xff && buf[j + 1] === 0xd9) {
          found = j + 2
          break
        }
        j++
        // cap un JPEG à 8 Mo
        if (j - i > 8_000_000) break
      }
      if (found > i + 200) {
        const img = buf.subarray(i, found)
        images.push(Buffer.from(img))
        pos = found
      } else {
        pos = i + 3
      }
    }
  }

  return {
    images,
    truncated: false,
    method: images.length ? "dct" : "none"
  }
}
