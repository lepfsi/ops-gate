/** Minimal CJS typing for sql.js under createRequire. */
declare module "sql.js" {
  type SqlJsDatabase = {
    run: (sql: string) => void
    exec: (sql: string) => Array<{ columns: string[]; values: unknown[][] }>
    export: () => Uint8Array
    close: () => void
  }
  type SqlJsStatic = {
    Database: new (data?: ArrayLike<number> | null) => SqlJsDatabase
  }
  function initSqlJs(config?: {
    locateFile?: (file: string) => string
  }): Promise<SqlJsStatic>
  export = initSqlJs
}
