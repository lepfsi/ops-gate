/** Minimal types for pdfjs-dist legacy ESM under Node. */
declare module "pdfjs-dist/legacy/build/pdf.mjs" {
  export function getDocument(src: {
    data: Uint8Array
    useSystemFonts?: boolean
    isEvalSupported?: boolean
    disableFontFace?: boolean
    useWorkerFetch?: boolean
    verbosity?: number
  }): {
    promise: Promise<{
      numPages: number
      getPage: (n: number) => Promise<{
        getTextContent: () => Promise<{
          items: Array<
            | { str: string; transform?: number[]; hasEOL?: boolean }
            | Record<string, unknown>
          >
        }>
      }>
      destroy: () => Promise<void>
    }>
  }
}
