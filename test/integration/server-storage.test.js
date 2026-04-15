import assert from 'node:assert/strict'
import path from 'path'
import { test } from './compat-test.js'
import Knex from 'knex'

import { Storage } from '@gamedev/server/Storage.js'
import { createTempDir } from './helpers.js'

class BunSqliteQuery {
  constructor(sqlite, tableName) {
    this.sqlite = sqlite
    this.tableName = tableName
    this.columns = []
    this.whereClauses = []
    this.params = []
    this.orderClause = ''
  }

  select(...columns) {
    this.columns = columns
    return this
  }

  where(arg1, arg2, arg3) {
    if (arg1 && typeof arg1 === 'object' && !Array.isArray(arg1)) {
      for (const [key, value] of Object.entries(arg1)) {
        this.whereClauses.push(`${key} = ?`)
        this.params.push(value)
      }
      return this
    }

    if (arg3 === undefined) {
      this.whereClauses.push(`${arg1} = ?`)
      this.params.push(arg2)
      return this
    }

    this.whereClauses.push(`${arg1} ${arg2} ?`)
    this.params.push(arg3)
    return this
  }

  whereIn(column, values) {
    if (!Array.isArray(values) || values.length === 0) {
      this.whereClauses.push('1 = 0')
      return this
    }
    this.whereClauses.push(`${column} IN (${values.map(() => '?').join(', ')})`)
    this.params.push(...values)
    return this
  }

  orderBy(column, direction = 'asc') {
    this.orderClause = ` ORDER BY ${column} ${String(direction).toUpperCase()}`
    return this
  }

  buildWhereClause() {
    if (!this.whereClauses.length) return ''
    return ` WHERE ${this.whereClauses.join(' AND ')}`
  }

  async executeSelect({ first = false } = {}) {
    const columns = this.columns.length ? this.columns.join(', ') : '*'
    const limit = first ? ' LIMIT 1' : ''
    const sql = `SELECT ${columns} FROM ${this.tableName}${this.buildWhereClause()}${this.orderClause}${limit}`
    const statement = this.sqlite.query(sql)
    const rows = statement.all(...this.params)
    return first ? rows[0] : rows
  }

  async first() {
    return this.executeSelect({ first: true })
  }

  async delete() {
    const sql = `DELETE FROM ${this.tableName}${this.buildWhereClause()}`
    this.sqlite.query(sql).run(...this.params)
  }

  insert(rows) {
    return new BunSqliteInsertQuery(this.sqlite, this.tableName, rows)
  }

  then(resolve, reject) {
    return this.executeSelect().then(resolve, reject)
  }
}

class BunSqliteInsertQuery {
  constructor(sqlite, tableName, rows) {
    this.sqlite = sqlite
    this.tableName = tableName
    this.rows = Array.isArray(rows) ? rows : [rows]
    this.conflictColumn = null
  }

  onConflict(column) {
    this.conflictColumn = column
    return this
  }

  async merge(columns) {
    if (!this.rows.length) return
    const keys = Object.keys(this.rows[0])
    const placeholders = `(${keys.map(() => '?').join(', ')})`
    const valuesSql = this.rows.map(() => placeholders).join(', ')
    const params = []
    for (const row of this.rows) {
      for (const key of keys) {
        params.push(row[key])
      }
    }
    const assignments = (Array.isArray(columns) ? columns : [])
      .map(column => `${column} = excluded.${column}`)
      .join(', ')
    const sql =
      `INSERT INTO ${this.tableName} (${keys.join(', ')}) VALUES ${valuesSql}` +
      (this.conflictColumn && assignments
        ? ` ON CONFLICT(${this.conflictColumn}) DO UPDATE SET ${assignments}`
        : '')
    this.sqlite.query(sql).run(...params)
  }
}

function createBunSqliteAdapter(filename) {
  return import('bun:sqlite').then(({ Database }) => {
    const sqlite = new Database(filename, { create: true })
    const adapter = tableName => new BunSqliteQuery(sqlite, tableName)
    adapter.schema = {
      async createTable(tableName) {
        if (tableName !== 'world_storage') {
          throw new Error(`unsupported_table:${tableName}`)
        }
        sqlite.exec(
          'CREATE TABLE world_storage (' +
            'key TEXT PRIMARY KEY, ' +
            'value TEXT NOT NULL, ' +
            'createdAt TEXT NOT NULL, ' +
            'updatedAt TEXT NOT NULL' +
          ')'
        )
      },
    }
    adapter.transaction = async callback => {
      sqlite.exec('BEGIN')
      const trx = tableName => new BunSqliteQuery(sqlite, tableName)
      try {
        const result = await callback(trx)
        sqlite.exec('COMMIT')
        return result
      } catch (error) {
        try {
          sqlite.exec('ROLLBACK')
        } catch {}
        throw error
      }
    }
    adapter.destroy = async () => {
      sqlite.close()
    }
    return adapter
  })
}

async function createStorageDB() {
  const dir = await createTempDir('hyperfy-storage-')
  const filename = path.join(dir, 'db.sqlite')
  const db = process.versions?.bun
    ? await createBunSqliteAdapter(filename)
    : Knex({
        client: 'better-sqlite3',
        connection: { filename },
        useNullAsDefault: true,
      })
  await db.schema.createTable('world_storage', table => {
    table.string('key').primary()
    table.text('value').notNullable()
    table.timestamp('createdAt').notNullable()
    table.timestamp('updatedAt').notNullable()
  })
  return { db, filename }
}

async function openStorageDB(filename) {
  if (process.versions?.bun) {
    return createBunSqliteAdapter(filename)
  }
  return Knex({
    client: 'better-sqlite3',
    connection: { filename },
    useNullAsDefault: true,
  })
}

test('storage close flushes pending writes and reloads from sqlite', async () => {
  const { db, filename } = await createStorageDB()
  try {
    const storage = new Storage(db, { flushIntervalMs: 25 })
    await storage.init()
    storage.set('counter', { value: 3, tags: ['a', 'b'] })
    await storage.close()
  } finally {
    await db.destroy()
  }

  const dbReloaded = await openStorageDB(filename)
  try {
    const storage = new Storage(dbReloaded)
    await storage.init()
    assert.deepEqual(storage.get('counter'), { value: 3, tags: ['a', 'b'] })
  } finally {
    await dbReloaded.destroy()
  }
})

test('storage remove deletes persisted keys', async () => {
  const { db } = await createStorageDB()
  try {
    const storage = new Storage(db, { flushIntervalMs: 25 })
    await storage.init()
    storage.set('greeting', 'hello')
    await storage.persist()

    storage.remove('greeting')
    await storage.persist()

    const row = await db('world_storage').where({ key: 'greeting' }).first()
    assert.equal(row, undefined)
    assert.equal(storage.get('greeting'), undefined)
  } finally {
    await db.destroy()
  }
})

test('mutating a fetched object does not persist until set is called again', async () => {
  const { db, filename } = await createStorageDB()
  try {
    const storage = new Storage(db, { flushIntervalMs: 25 })
    await storage.init()
    storage.set('prefs', { theme: 'dark', volume: 0.5 })
    await storage.persist()

    const prefs = storage.get('prefs')
    prefs.theme = 'light'

    await storage.close()
  } finally {
    await db.destroy()
  }

  const dbReloaded = await openStorageDB(filename)
  try {
    const storage = new Storage(dbReloaded)
    await storage.init()
    assert.deepEqual(storage.get('prefs'), { theme: 'dark', volume: 0.5 })
  } finally {
    await dbReloaded.destroy()
  }
})

test('storage getFresh reads writes from another storage instance', async () => {
  const { db, filename } = await createStorageDB()
  try {
    const storageA = new Storage(db, { flushIntervalMs: 25 })
    await storageA.init()

    const dbReloaded = await openStorageDB(filename)

    try {
      const storageB = new Storage(dbReloaded, { flushIntervalMs: 25 })
      await storageB.init()

      await storageA.setFresh('shared', { version: 1, name: 'first' })
      assert.deepEqual(await storageB.getFresh('shared'), { version: 1, name: 'first' })

      await storageB.setFresh('shared', { version: 2, name: 'second' })
      assert.deepEqual(await storageA.getFresh('shared'), { version: 2, name: 'second' })
    } finally {
      await dbReloaded.destroy()
    }
  } finally {
    await db.destroy()
  }
})

test('storage commit rejects stale conditional writes', async () => {
  const { db, filename } = await createStorageDB()
  try {
    const storageA = new Storage(db, { flushIntervalMs: 25 })
    await storageA.init()
    await storageA.setFresh('town', { version: 1 })
    const entryA = await storageA.getFreshEntry('town')

    const dbReloaded = await openStorageDB(filename)

    try {
      const storageB = new Storage(dbReloaded, { flushIntervalMs: 25 })
      await storageB.init()
      const entryB = await storageB.getFreshEntry('town')
      assert.equal(entryB.updatedAt, entryA.updatedAt)

      const success = await storageA.commit([{
        key: 'town',
        value: { version: 2 },
        expectedUpdatedAt: entryA.updatedAt,
      }])
      assert.equal(success.ok, true)

      const stale = await storageB.commit([{
        key: 'town',
        value: { version: 3 },
        expectedUpdatedAt: entryB.updatedAt,
      }])
      assert.equal(stale.ok, false)
      assert.equal(stale.conflicts.length, 1)
      assert.deepEqual(stale.conflicts[0].value, { version: 2 })

      assert.deepEqual(await storageB.getFresh('town'), { version: 2 })
    } finally {
      await dbReloaded.destroy()
    }
  } finally {
    await db.destroy()
  }
})

test('storage commit supports create-if-absent and fresh prefix scans', async () => {
  const { db, filename } = await createStorageDB()
  try {
    const storageA = new Storage(db, { flushIntervalMs: 25 })
    await storageA.init()

    const created = await storageA.commit([{
      key: 'players:alice',
      value: { points: 5 },
      expectedUpdatedAt: null,
    }])
    assert.equal(created.ok, true)

    const dbReloaded = await openStorageDB(filename)

    try {
      const storageB = new Storage(dbReloaded, { flushIntervalMs: 25 })
      await storageB.init()

      const staleCreate = await storageB.commit([{
        key: 'players:alice',
        value: { points: 8 },
        expectedUpdatedAt: null,
      }])
      assert.equal(staleCreate.ok, false)
      assert.equal(staleCreate.conflicts.length, 1)
      assert.deepEqual(staleCreate.conflicts[0].value, { points: 5 })

      await storageA.setFresh('players:bob', { points: 7 })
      await storageA.setFresh('market:btc', { volume: 12 })

      const entries = await storageB.getFreshEntriesByPrefix('players:')
      assert.deepEqual(
        entries.map(entry => [entry.key, entry.value]),
        [
          ['players:alice', { points: 5 }],
          ['players:bob', { points: 7 }],
        ]
      )

      const keys = await storageB.listKeys('players:')
      assert.deepEqual(keys, ['players:alice', 'players:bob'])
    } finally {
      await dbReloaded.destroy()
    }
  } finally {
    await db.destroy()
  }
})
